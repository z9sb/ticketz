/* eslint-disable prettier/prettier */
import path, { join } from "path";
import { promisify } from "util";
import fs, { writeFile } from "fs";
import * as Sentry from "@sentry/node";
import { isNil, isNull, head } from "lodash";

import {
  WASocket,
  downloadContentFromMessage,
  extractMessageContent,
  getContentType,
  jidNormalizedUser,
  MediaType,
  MessageUpsertType,
  proto,
  WAMessage,
  WAMessageStubType,
  WAMessageUpdate,
} from "@whiskeysockets/baileys";
import { Mutex } from "async-mutex";
import { Op } from "sequelize";
import moment from "moment";
import { Transform } from "stream";
import { Throttle } from "stream-throttle";
import { Sequelize } from "sequelize-typescript";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";
import OldMessage from "../../models/OldMessage";

import { getIO } from "../../libs/socket";
import CreateMessageService from "../MessageServices/CreateMessageService";
import { logger } from "../../utils/logger";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import formatBody from "../../helpers/Mustache";
import { Store } from "../../libs/store";
import TicketTraking from "../../models/TicketTraking";
import UserRating from "../../models/UserRating";
import SendWhatsAppMessage from "./SendWhatsAppMessage";
import Queue from "../../models/Queue";
import QueueOption from "../../models/QueueOption";
import VerifyCurrentSchedule, { ScheduleResult } from "../CompanyService/VerifyCurrentSchedule";
import Campaign from "../../models/Campaign";
import CampaignShipping from "../../models/CampaignShipping";
import { campaignQueue, parseToMilliseconds, randomValue } from "../../queues";
import User from "../../models/User";
import Setting from "../../models/Setting";
import { cacheLayer } from "../../libs/cache";
import { debounce } from "../../helpers/Debounce";
import { getMessageOptions } from "./SendWhatsAppMedia";
import { makeRandomId } from "../../helpers/MakeRandomId";
import CheckSettings, { GetCompanySetting } from "../../helpers/CheckSettings";
import Whatsapp from "../../models/Whatsapp";
import { SimpleObjectCache } from "../../helpers/simpleObjectCache";

type Session = WASocket & {
  id?: number;
  store?: Store;
};

interface ImessageUpsert {
  messages: proto.IWebMessageInfo[];
  type: MessageUpsertType;
}

interface IMe {
  name: string;
  id: string;
}

const writeFileAsync = promisify(writeFile);

const createTicketMutex = new Mutex();
const wbotMutex = new Mutex();
const ackMutex = new Mutex();

const groupContactCache = new SimpleObjectCache(1000 * 30, logger);

const getTypeMessage = (msg: proto.IWebMessageInfo): string => {
  return getContentType(msg.message);
};

const getTypeEditedMessage = (msg: proto.IMessage): string => {
  return getContentType(msg);
};

export function makeid(length: number) {
  let result = "";
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i+=1) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

const getBodyButton = (msg: proto.IWebMessageInfo): string => {
  if (msg.key.fromMe && msg?.message?.viewOnceMessage?.message?.buttonsMessage?.contentText) {
    let bodyMessage = `*${msg?.message?.viewOnceMessage?.message?.buttonsMessage?.contentText}*`;

    msg.message?.viewOnceMessage?.message?.buttonsMessage?.buttons.forEach((button) => {
      bodyMessage += `\n\n${button.buttonText?.displayText}`;
    });
    return bodyMessage;
  }

  if (msg.key.fromMe && msg?.message?.viewOnceMessage?.message?.listMessage) {
    let bodyMessage = `*${msg?.message?.viewOnceMessage?.message?.listMessage?.description}*`;
    msg.message?.viewOnceMessage?.message?.listMessage?.sections.forEach((button) => {
      button.rows.forEach((rows) => {
        bodyMessage += `\n\n${rows.title}`;
      });
    });

    return bodyMessage;
  }

  return "";
};

const msgLocation = (
    image: Uint8Array | ArrayBuffer | { valueOf(): ArrayBuffer | SharedArrayBuffer; },
    latitude: number,
    longitude: number
  ) => {
  if (image) {
    const b64 = Buffer.from(image).toString("base64");

    const data = `data:image/png;base64, ${b64} | https://maps.google.com/maps?q=${latitude}%2C${longitude}&z=17&hl=pt-BR|${latitude}, ${longitude} `;
    return data;
  }
  return "";
};

export const getBodyMessage = (msg: proto.IWebMessageInfo): string | null => {

  try {
    const type = getTypeMessage(msg);

    const types = {
      conversation: msg?.message?.conversation,
      editedMessage: msg?.message?.editedMessage?.message?.protocolMessage?.editedMessage?.conversation,
      imageMessage: msg.message?.imageMessage?.caption,
      videoMessage: msg.message?.videoMessage?.caption,
      extendedTextMessage: msg.message?.extendedTextMessage?.text,
      buttonsResponseMessage: msg.message?.buttonsResponseMessage?.selectedButtonId,
      templateButtonReplyMessage: msg.message?.templateButtonReplyMessage?.selectedId,
      messageContextInfo: msg.message?.buttonsResponseMessage?.selectedButtonId || msg.message?.listResponseMessage?.title,
      buttonsMessage: getBodyButton(msg) || msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId,
      viewOnceMessage: getBodyButton(msg) || msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId,
      viewOnceMessageV2: msg.message?.viewOnceMessageV2?.message?.imageMessage?.caption || "",
      stickerMessage: "sticker",
      contactMessage: 
        msg.message?.contactMessage?.vcard &&
        JSON.stringify(
          {
            ticketzvCard: [
              {
                displayName: msg.message.contactMessage.displayName,
                vcard: msg.message.contactMessage.vcard
              }
            ]
          }),
      contactsArrayMessage: msg.message?.contactsArrayMessage &&
        JSON.stringify(
          {
            ticketzvCard: msg.message.contactsArrayMessage.contacts
          }),
      // locationMessage: `Latitude: ${msg.message.locationMessage?.degreesLatitude} - Longitude: ${msg.message.locationMessage?.degreesLongitude}`,
      locationMessage: msgLocation(
        msg.message?.locationMessage?.jpegThumbnail,
        msg.message?.locationMessage?.degreesLatitude,
        msg.message?.locationMessage?.degreesLongitude
      ),
      liveLocationMessage: `Latitude: ${msg.message?.liveLocationMessage?.degreesLatitude} - Longitude: ${msg.message?.liveLocationMessage?.degreesLongitude}`,
      documentMessage: msg.message?.documentMessage?.title,
      documentWithCaptionMessage: msg.message?.documentWithCaptionMessage?.message?.documentMessage?.caption,
      audioMessage: "Áudio",
      listMessage: getBodyButton(msg) || msg.message?.listResponseMessage?.title,
      listResponseMessage: msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId,
      reactionMessage: msg.message?.reactionMessage?.text || "reaction",
    };

    const objKey = Object.keys(types).find(key => key === type);

    if (!objKey) {
      logger.warn(`#### Nao achou o type 152: ${type} \n ${JSON.stringify(msg)}`);
      Sentry.setExtra("Mensagem", { BodyMsg: msg.message, msg, type });
      Sentry.captureException(
        new Error("Novo Tipo de Mensagem em getTypeMessage")
      );
    }
    return types[type];
  } catch (error) {
    Sentry.setExtra("Error getTypeMessage", { msg, BodyMsg: msg.message });
    Sentry.captureException(error);
    logger.error({error, msg}, `getBodyMessage: error: ${error?.message}`);
    return null;
  }
};


export const getQuotedMessage = (msg: proto.IWebMessageInfo) => {
  const body =
    msg.message.imageMessage.contextInfo ||
    msg.message.videoMessage.contextInfo ||
    msg.message?.documentMessage ||
    msg.message.extendedTextMessage.contextInfo ||
    msg.message.buttonsResponseMessage.contextInfo ||
    msg.message.listResponseMessage.contextInfo ||
    msg.message.templateButtonReplyMessage.contextInfo ||
    msg.message.buttonsResponseMessage?.contextInfo ||
    msg.message?.buttonsResponseMessage?.selectedButtonId ||
    msg.message.listResponseMessage?.singleSelectReply?.selectedRowId ||
    msg.message?.listResponseMessage?.singleSelectReply.selectedRowId ||
    msg.message.listResponseMessage?.contextInfo ||
    msg.message.senderKeyDistributionMessage;

  // testar isso

  return extractMessageContent(body[Object.keys(body).values().next().value]);
};
export const getQuotedMessageId = (msg: proto.IWebMessageInfo) => {
  const body = extractMessageContent(msg.message)[
    Object.keys(msg?.message).values().next().value
  ];

  return body?.contextInfo?.stanzaId;
};

const getMeSocket = (wbot: Session): IMe => {

  return {
    id: jidNormalizedUser((wbot as WASocket).user.id),
    name: (wbot as WASocket).user.name
  };
};

const getSenderMessage = (
  msg: proto.IWebMessageInfo,
  wbot: Session
): string => {
  const me = getMeSocket(wbot);
  if (msg.key.fromMe) return me.id;

  const senderId = msg.participant || msg.key.participant || msg.key.remoteJid || undefined;

  return senderId && jidNormalizedUser(senderId);
};

const getContactMessage = async (msg: proto.IWebMessageInfo, wbot: Session) => {

  const isGroup = msg.key.remoteJid.includes("g.us");
  const rawNumber = msg.key.remoteJid.replace(/\D/g, "");
  return isGroup
    ? {
      id: getSenderMessage(msg, wbot),
      name: msg.pushName
    }
    : {
      id: msg.key.remoteJid,
      name: msg.key.fromMe ? rawNumber : msg.pushName
    };
};


const getUnpackedMessage = (msg: proto.IWebMessageInfo) => {
  return (
    msg.message?.documentWithCaptionMessage?.message ||
    msg.message?.ephemeralMessage?.message ||
    msg.message?.viewOnceMessage?.message ||
    msg.message?.viewOnceMessageV2?.message ||
    msg.message?.ephemeralMessage?.message ||
    msg.message?.templateMessage?.hydratedTemplate ||
    msg.message?.templateMessage?.hydratedFourRowTemplate ||
    msg.message?.templateMessage?.fourRowTemplate ||
    msg.message?.interactiveMessage?.header ||
    msg.message?.highlyStructuredMessage?.hydratedHsm?.hydratedTemplate ||
    msg.message
  )
}

const getMessageMedia = (message: proto.IMessage) => {
  return ( 
      message?.imageMessage ||
      message?.audioMessage ||
      message?.videoMessage ||
      message?.stickerMessage ||
      message?.documentMessage || null
  );
}

const downloadStream = async (stream: Transform): Promise<Buffer> => {
  const MAX_SPEED = 5 * 1024 * 1024 / 8; // 5Mbps
  const THROTTLE_SPEED = 1024 * 1024 / 8; // 1Mbps
  const LARGE_FILE_SIZE = 1024 * 1024; // 1 MiB

  const throttle = new Throttle({ rate: MAX_SPEED });
  let buffer = Buffer.from([]);
  let totalSize = 0;

  try {
    // eslint-disable-next-line no-restricted-syntax
    for await (const chunk of stream.pipe(throttle)) {
      buffer = Buffer.concat([buffer, chunk]);
      totalSize += chunk.length;

      if (totalSize > LARGE_FILE_SIZE) {
        throttle.rate = THROTTLE_SPEED;
      }
    }
  } catch (error) {
    Sentry.setExtra("ERR_WAPP_DOWNLOAD_MEDIA", { error });
    Sentry.captureException(new Error("ERR_WAPP_DOWNLOAD_MEDIA"));
    throw new Error("ERR_WAPP_DOWNLOAD_MEDIA");
  }

  return buffer;  
}

type ThumbnailMessage = {
    mediaKey?: Uint8Array | null;
    thumbnailDirectPath?: string | null;
    mimetype?: string;
};

const downloadThumbnail = async ({ thumbnailDirectPath: directPath, mediaKey, mimetype }: ThumbnailMessage) => {
  if (!directPath || !mediaKey) {
    return null;
  }
  
  const stream = await downloadContentFromMessage(
    { mediaKey, directPath },
    mimetype ? "thumbnail-document" : "thumbnail-link"
  );

  if (!stream) {
    throw new Error("Failed to get stream");
  }

  const buffer = await downloadStream(stream);

  if (!buffer) {
    throw new Error("ERR_WAPP_DOWNLOAD_MEDIA");
  }

  const filename = `thumbnail-${makeRandomId(5)}-${new Date().getTime()}.jpg`;

  const media = {
    data: buffer,
    mimetype: "image/jpeg",
    filename
  };
  return media;
}

const downloadMedia = async (msg: proto.IWebMessageInfo, wbot: Session, ticket: Ticket) => {
  const unpackedMessage = getUnpackedMessage(msg);
  const message = getMessageMedia(unpackedMessage);
  
  if (!message) {
    return null;
  }

  const fileLimit = parseInt(await CheckSettings("downloadLimit", "15"), 10);
  if (wbot && message?.fileLength && +message.fileLength > fileLimit*1024*1024) {
    const fileLimitMessage = {
      text: `*Mensagem Automática*:\nNosso sistema aceita apenas arquivos com no máximo ${fileLimit} MiB`
    };

    if (!ticket.isGroup) {
      const sendMsg = await wbot.sendMessage(
        `${ticket.contact.number}@s.whatsapp.net`,
        fileLimitMessage
      );

      sendMsg.message.extendedTextMessage.text = "*Mensagem do sistema*:\nArquivo recebido além do limite de tamanho do sistema, se for necessário ele pode ser obtido no aplicativo do whatsapp.";

      // eslint-disable-next-line no-use-before-define
      await verifyMessage(sendMsg, ticket, ticket.contact);
    }
    throw new Error("ERR_FILESIZE_OVER_LIMIT");
  }

  // eslint-disable-next-line no-nested-ternary
  const messageType = unpackedMessage?.documentMessage 
    ? "document"
    : message.mimetype.split("/")[0].replace("application", "document")
      ? (message.mimetype
        .split("/")[0]
        .replace("application", "document") as MediaType)
      : (message.mimetype.split("/")[0] as MediaType);

  let stream: Transform;
  let contDownload = 0;

  while (contDownload < 10 && !stream) {
    try {

      const tmpMessage = { ...message }; 
      if (tmpMessage?.directPath) {
        tmpMessage.url = "";
      }

      // eslint-disable-next-line no-await-in-loop
      stream = await downloadContentFromMessage(tmpMessage, messageType);
    } catch (error) {
      contDownload += 1;
      // eslint-disable-next-line no-await-in-loop, no-loop-func
      await new Promise(resolve => {setTimeout(resolve, 1000 * contDownload * 2)});
      logger.warn(`>>>> erro ${contDownload} de baixar o arquivo ${msg?.key?.id}`);
    }
  }

  if (!stream) {
    throw new Error("Failed to get stream");
  }

  const buffer = await downloadStream(stream);

  if (!buffer) {
    Sentry.setExtra("ERR_WAPP_DOWNLOAD_MEDIA", { msg });
    Sentry.captureException(new Error("ERR_WAPP_DOWNLOAD_MEDIA"));
    throw new Error("ERR_WAPP_DOWNLOAD_MEDIA");
  }

  let filename = unpackedMessage?.documentMessage?.fileName || "";

  if (!filename) {
    const ext = message.mimetype.split("/")[1].split(";")[0];
    filename = `${makeRandomId(5)}-${new Date().getTime()}.${ext}`;
  } else {
    filename = `${filename.split(".").slice(0, -1).join(".")}.${makeRandomId(5)}.${filename.split(".").slice(-1)}`;
  }

  const media = {
    data: buffer,
    mimetype: message.mimetype,
    filename
  };
  return media;
};

const verifyContact = async (
  msgContact: IMe,
  wbot: Session,
  companyId: number
): Promise<Contact> => {
  let profilePicUrl: string;
  try {
    profilePicUrl = await wbot.profilePictureUrl(msgContact.id);
  } catch (e) {
    Sentry.captureException(e);
    profilePicUrl = `${process.env.FRONTEND_URL}/nopicture.png`;
  }

  const contactData = {
    name: msgContact?.name || msgContact.id.replace(/\D/g, ""),
    number: msgContact.id.substring(0, msgContact.id.indexOf("@")),
    profilePicUrl,
    isGroup: msgContact.id.includes("g.us"),
    companyId,
  };



  const contact = CreateOrUpdateContactService(contactData);

  return contact;
};

const verifyQuotedMessage = async (
  msg: proto.IWebMessageInfo
): Promise<Message | null> => {
  if (!msg) return null;
  const quoted = getQuotedMessageId(msg);

  if (!quoted) return null;

  const quotedMsg = await Message.findOne({
    where: { id: quoted },
  });

  if (!quotedMsg) return null;

  return quotedMsg;
};

const saveMediaToFile = async (media) => {
  if (!media.filename) {
    const ext = media.mimetype.split("/")[1].split(";")[0];
    media.filename = `${new Date().getTime()}.${ext}`;
  }

  const filePath = __dirname.endsWith("/dist")
    ? path.resolve(__dirname, "..", "public")
    : path.resolve(__dirname, "..", "..", "..", "public");

  try {
    await writeFileAsync(
      join(filePath, media.filename),
      media.data,
      "base64"
    );
  } catch (err) {
    Sentry.captureException(err);
    logger.error(err);
  }
}

export const verifyMediaMessage = async (
  msg: proto.IWebMessageInfo,
  ticket: Ticket,
  contact: Contact,
  wbot: Session = null,
  messageMedia = null,
): Promise<Message> => {
  const io = getIO();
  const quotedMsg = await verifyQuotedMessage(msg);
  
  const thumbnailMsg = messageMedia || msg?.message?.extendedTextMessage;
  const thumbnailMedia = thumbnailMsg && await downloadThumbnail(thumbnailMsg);
  const media = await downloadMedia(msg, wbot, ticket);

  if (!media && !thumbnailMedia) {
    throw new Error("ERR_WAPP_DOWNLOAD_MEDIA");
  }

  if (media) {
    await saveMediaToFile(media);
  }
  
  if (thumbnailMedia) {
    await saveMediaToFile(thumbnailMedia);
  }

  const body = getBodyMessage(msg);

  const messageData = {
    id: msg.key.id,
    ticketId: ticket.id,
    contactId: msg.key.fromMe ? undefined : contact.id,
    body: body || media?.filename,
    fromMe: msg.key.fromMe,
    read: msg.key.fromMe,
    mediaUrl: media?.filename,
    mediaType: media?.mimetype.split("/")[0],
    thumbnailUrl: thumbnailMedia?.filename,
    quotedMsgId: quotedMsg?.id,
    ack: msg.status,
    remoteJid: msg.key.remoteJid,
    participant: msg.key.participant,
    dataJson: JSON.stringify(msg),
  };

  await ticket.update({
    lastMessage: body || media?.filename,
  });

  const newMessage = await CreateMessageService({
    messageData,
    companyId: ticket.companyId,
  });

  if (!msg.key.fromMe && ticket.status === "closed") {
    await ticket.update({ status: "pending" });
    await ticket.reload({
      include: [
        { model: Queue, as: "queue" },
        { model: User, as: "user" },
        { model: Contact, as: "contact" },
      ],
    });

    io.to(`company-${ticket.companyId}-closed`)
      .to(`queue-${ticket.queueId}-closed`)
      .emit(`company-${ticket.companyId}-ticket`, {
        action: "delete",
        ticket,
        ticketId: ticket.id,
      });

    io.to(`company-${ticket.companyId}-${ticket.status}`)
      .to(`queue-${ticket.queueId}-${ticket.status}`)
      .to(ticket.id.toString())
      .emit(`company-${ticket.companyId}-ticket`, {
        action: "update",
        ticket,
        ticketId: ticket.id,
      });
  }

  return newMessage;
};

export const verifyMessage = async (
  msg: proto.IWebMessageInfo,
  ticket: Ticket,
  contact: Contact
) => {
  const io = getIO();
  const quotedMsg = await verifyQuotedMessage(msg);
  const body = getBodyMessage(msg);

  const messageData = {
    id: msg.key.id,
    ticketId: ticket.id,
    contactId: msg.key.fromMe ? undefined : contact.id,
    body,
    fromMe: msg.key.fromMe,
    mediaType: getTypeMessage(msg),
    read: msg.key.fromMe,
    quotedMsgId: quotedMsg?.id,
    ack: msg.status,
    remoteJid: msg.key.remoteJid,
    participant: msg.key.participant,
    dataJson: JSON.stringify(msg),
    isEdited: false,
  };

  await ticket.update({
    lastMessage: body
  });

  await CreateMessageService({ messageData, companyId: ticket.companyId });

  if (!msg.key.fromMe && ticket.status === "closed") {
    await ticket.update({ status: "pending" });
    await ticket.reload({
      include: [
        { model: Queue, as: "queue" },
        { model: User, as: "user" },
        { model: Contact, as: "contact" }
      ]
    });

    io.to(`company-${ticket.companyId}-closed`)
      .to(`queue-${ticket.queueId}-closed`)
      .emit(`company-${ticket.companyId}-ticket`, {
        action: "delete",
        ticket,
        ticketId: ticket.id
      });

    io.to(`company-${ticket.companyId}-${ticket.status}`)
      .to(`queue-${ticket.queueId}-${ticket.status}`)
      .to(ticket.id.toString())
      .emit(`company-${ticket.companyId}-ticket`, {
        action: "update",
        ticket,
        ticketId: ticket.id
      });
  }
};

export const verifyEditedMessage = async (
  msg: proto.IMessage,
  ticket: Ticket,
  msgId: string,
) => {
  const editedType = getTypeEditedMessage(msg);

  let editedText: string;

  switch (editedType) {
    case "conversation": {
      editedText = msg.conversation
      break;
    }
    case "extendedTextMessage": {
      editedText = msg.extendedTextMessage.text;
      break;
    }
    case "imageMessage": {
      editedText = msg.imageMessage.caption;
      break;
    }
    case "documentMessage": {
      editedText = msg.documentMessage.caption;
      break;
    }
    case "documentWithCaptionMessage": {
      editedText = msg.documentWithCaptionMessage.message.documentMessage.caption;
      break;
    }
    default: {
      return;
    }
  }

  const editedMsg = await Message.findByPk(msgId);
  const messageData = {
    id: editedMsg.id,
    ticketId: editedMsg.ticketId,
    contactId: editedMsg.contactId,
    body: editedText,
    fromMe: editedMsg.fromMe,
    mediaType: editedMsg.mediaType,
    read: editedMsg.read,
    quotedMsgId: editedMsg.quotedMsgId,
    ack: editedMsg.ack,
    remoteJid: editedMsg.remoteJid,
    participant: editedMsg.participant,
    dataJson: editedMsg.dataJson,
    isEdited: true,
  };

  const oldMessage = {
    messageId: messageData.id,
    body: editedMsg.body,
    ticketId: editedMsg.ticketId
  }

  await OldMessage.upsert(oldMessage);

  await ticket.update({
    lastMessage: messageData.body
  });

  await CreateMessageService({ messageData, companyId: ticket.companyId });

  const io = getIO();

  io.to(ticket.status)
    .to(ticket.id.toString())
    .emit(`company-${ticket.companyId}-ticket`, {
      action: "update",
      ticket,
      ticketId: ticket.id
    });
}

export const verifyDeleteMessage = async (
  msg: proto.Message.IProtocolMessage,
  ticket: Ticket
) => {

  const message = await Message.findByPk(msg.key.id, {
    include: [
      "contact",
      {
        model: Ticket,
        include: [
          {
            model: Contact
          }
        ]
      }
    ]
  });
  
  if (!message) {
    return;
  }

  await message.update({
    isDeleted: true
  });

  const io = getIO();
  io.to(message.ticketId.toString())
    .to(message.ticket.status)
    .to("notification")
    .emit(`company-${ticket.companyId}-appMessage`, {
      action: "create",
      message,
      ticket: message.ticket,
      contact: message.ticket.contact
    });

}

const isValidMsg = (msg: proto.IWebMessageInfo): boolean => {
  if (msg.key.remoteJid === "status@broadcast") return false;
  try {
    const msgType = getTypeMessage(msg);
    if (!msgType) {
      return false;
    }

    const ifType =
      msgType === "conversation" ||
      msgType === "editedMessage" ||
      msgType === "extendedTextMessage" ||
      msgType === "audioMessage" ||
      msgType === "videoMessage" ||
      msgType === "imageMessage" ||
      msgType === "documentMessage" ||
      msgType === "documentWithCaptionMessage" ||
      msgType === "stickerMessage" ||
      msgType === "buttonsResponseMessage" ||
      msgType === "buttonsMessage" ||
      msgType === "messageContextInfo" ||
      msgType === "locationMessage" ||
      msgType === "liveLocationMessage" ||
      msgType === "contactMessage" ||
      msgType === "voiceMessage" ||
      msgType === "mediaMessage" ||
      msgType === "contactsArrayMessage" ||
      msgType === "reactionMessage" ||
      msgType === "ephemeralMessage" ||
      msgType === "protocolMessage" ||
      msgType === "listResponseMessage" ||
      msgType === "listMessage" ||
      msgType === "viewOnceMessage" || 
      msgType === "viewOnceMessageV2";

    if (!ifType) {
      logger.warn(`#### Nao achou o type em isValidMsg: ${msgType}
${JSON.stringify(msg?.message)}`);
      Sentry.setExtra("Mensagem", { BodyMsg: msg.message, msg, msgType });
      Sentry.captureException(new Error("Novo Tipo de Mensagem em isValidMsg"));
    }

    return !!ifType;
  } catch (error) {
    Sentry.setExtra("Error isValidMsg", { msg });
    Sentry.captureException(error);
    return false;
  }
};

const sendMenu = async (
  wbot: Session,
  ticket: Ticket,
  currentOption: Queue | QueueOption,
  sendBackToMain = true
) => {

  const { companyId } = ticket;
  const buttonActive = await Setting.findOne({
    where: {
      key: "chatBotType",
      companyId
    }
  });

  const message =
    currentOption instanceof Queue
      ? (currentOption as Queue).greetingMessage
      : (currentOption as QueueOption).message;

  const botList = async () => {
    const sectionsRows = [];

    currentOption.options.forEach((option) => {
      sectionsRows.push({
        title: option.title,
        rowId: `${option.option}`
      });
    });
    if (sendBackToMain) {
      sectionsRows.push({
        title: "Voltar Menu Inicial",
        rowId: "#"
      });
    }
    const sections = [
      {
        rows: sectionsRows
      }
    ];

    const listMessage = {
      text: formatBody(`${message}`, ticket.contact),
      buttonText: "Escolha uma opção",
      sections
    };

    const sendMsg = await wbot.sendMessage(
      `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
      listMessage
    );

    await verifyMessage(sendMsg, ticket, ticket.contact);
  }

  const botButton = async () => {
    const buttons = [];
    currentOption.options.forEach((option) => {
      buttons.push({
        buttonId: `${option.option}`,
        buttonText: { displayText: option.title },
        type: 4
      });
    });
    if  (sendBackToMain) {
      buttons.push({
        buttonId: "#",
        buttonText: { displayText: "Voltar Menu Inicial" },
        type: 4
      });
    }
    const buttonMessage = {
      text: formatBody(`${message}`, ticket.contact),
      buttons,
      headerType: 4
    };

    const sendMsg = await wbot.sendMessage(
      `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
      buttonMessage
    );

    await verifyMessage(sendMsg, ticket, ticket.contact);
  }

  const botText = async () => {
    let options = "";

    currentOption.options.forEach((option) => {
      options += `*[ ${option.option} ]* - ${option.title}\n`;
    });

    if (sendBackToMain) {
      options += "\n*[ # ]* - Voltar Menu Inicial";
    }

    const textMessage = {
      text: formatBody(`${message}\n\n${options}`, ticket.contact),
    };

    const sendMsg = await wbot.sendMessage(
      `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
      textMessage
    );

    await verifyMessage(sendMsg, ticket, ticket.contact);
  };

  switch (buttonActive.value) {
    case "list":
      botList();
      break;
    case "button":
      if (QueueOption.length > 4) {
        botText();
      } else {
        botButton();
      }
      break;
    case "text":
      botText();
      break;
    default:
  }
  
}

const startQueue = async (wbot: Session, ticket: Ticket, queue: Queue, sendBackToMain = true) => {
    const {companyId, contact} = ticket;
    let chatbot = false;

    if (queue?.options) {
      chatbot = queue.options.length > 0;
    }
    await UpdateTicketService({
      ticketData: { queueId: queue.id, chatbot, status: "pending" },
      ticketId: ticket.id,
      companyId: ticket.companyId,
    });

    let filePath = null;
    let optionsMsg = null;
    
    if (queue.mediaPath !== null && queue.mediaPath !== "") {
      filePath = path.resolve("public", queue.mediaPath);
      optionsMsg = await getMessageOptions(queue.mediaName, filePath);
    }

    /* Tratamento para envio de mensagem quando a fila está fora do expediente */
      let currentSchedule: ScheduleResult;

      const settings = await Setting.findOne({
        where: {
          key: "scheduleType",
          companyId
        }
      });
      if (settings?.value === "queue") {
        currentSchedule = await VerifyCurrentSchedule(ticket.companyId, queue.id);
      }

      if (
        settings?.value === "queue" &&
        !isNil(currentSchedule) &&
        (!currentSchedule || currentSchedule.inActivity === false)
      ) {
        const outOfHoursMessage = queue.outOfHoursMessage?.trim() || "Estamos fora do horário de expediente";
        const body = formatBody(`${outOfHoursMessage}\n\n*[ # ]* - Voltar ao Menu Principal`, ticket.contact);
        const sentMessage = await wbot.sendMessage(
          `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`, {
          text: body,
        }
        );
        await verifyMessage(sentMessage, ticket, contact);
        await UpdateTicketService({
          ticketData: { queueId: null, chatbot },
          ticketId: ticket.id,
          companyId: ticket.companyId,
        });
        return;
      }

    if (queue.options.length === 0) {
      if (queue.greetingMessage?.trim()) {
        const body = formatBody(`${queue.greetingMessage.trim()}`, ticket.contact);

        if (filePath) {
          optionsMsg.caption = body;
        } else {
          const sentMessage = await wbot.sendMessage(
            `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`, {
            text: body,
          }
          );
          await verifyMessage(sentMessage, ticket, contact);
          return;
        }
      }
      
      if (filePath) {
        const sentMediaMessage = await wbot.sendMessage(`${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`, { ...optionsMsg });
        await verifyMediaMessage(sentMediaMessage, ticket, contact);
      }
    } else {
      if (filePath) {
        const sentMediaMessage = await wbot.sendMessage(`${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`, { ...optionsMsg });
        await verifyMediaMessage(sentMediaMessage, ticket, contact);
      }
      sendMenu(wbot, ticket, queue, sendBackToMain);
    }
};

const verifyQueue = async (
  wbot: Session,
  msg: proto.IWebMessageInfo | null,
  ticket: Ticket,
  contact: Contact
) => {
  const { queues, greetingMessage } = await ShowWhatsAppService(
    wbot.id!,
    ticket.companyId
  )

  if (queues.length === 1) {
    await startQueue(wbot, ticket, head(queues), false);
    return;
  }

  const selectedOption = msg ? getBodyMessage(msg) : null;
  const choosenQueue = selectedOption ? queues[+selectedOption - 1] : null;

  const {companyId} = ticket;

  const buttonActive = await Setting.findOne({
    where: {
      key: "chatBotType",
      companyId
    }
  });


  const botList = async () => {
    const sectionsRows = [];

    queues.forEach((queue, index) => {
      sectionsRows.push({
        title: queue.name,
        rowId: `${index + 1}`
      });
    });

    const sections = [
      {
        rows: sectionsRows
      }
    ];

    const listMessage = {
      text: formatBody(`${greetingMessage}`, contact),
      buttonText: "Escolha uma opção",
      sections
    };

    const sendMsg = await wbot.sendMessage(
      `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
      listMessage
    );

    await verifyMessage(sendMsg, ticket, ticket.contact);
  }

  const botButton = async () => {
    const buttons = [];
    queues.forEach((queue, index) => {
      buttons.push({
        buttonId: `${index + 1}`,
        buttonText: { displayText: queue.name },
        type: 4
      });
    });

    const buttonMessage = {
      text: formatBody(`${greetingMessage}`, contact),
      buttons,
      headerType: 4
    };

    const sendMsg = await wbot.sendMessage(
      `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
      buttonMessage
    );

    await verifyMessage(sendMsg, ticket, ticket.contact);
  }

  const botText = async () => {
    let options = "";

    queues.forEach((queue, index) => {
      options += `*[ ${index + 1} ]* - ${queue.name}\n`;
    });


    const textMessage = {
      text: formatBody(`${greetingMessage}\n\n${options}`, contact),
    };

    const sendMsg = await wbot.sendMessage(
      `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
      textMessage
    );

    await verifyMessage(sendMsg, ticket, ticket.contact);
  };

  if (choosenQueue) {
    await startQueue(wbot, ticket, choosenQueue);
  } else {
    switch (buttonActive.value) {
      case "list":
        botList();
        break;
      case "button":
        if (queues.length > 4) {
          botText();
        } else {
          botButton();
        }
        break;
      case "text":
        botText();
        break;
      default:
    }
  }

};


export const verifyRating = (ticketTraking: TicketTraking) => {
  if (
    ticketTraking &&
    ticketTraking.finishedAt === null &&
    ticketTraking.userId !== null &&
    ticketTraking.ratingAt !== null
  ) {
    return true;
  }
  return false;
};

export const handleRating = async (
  msg: WAMessage,
  ticket: Ticket,
  ticketTraking: TicketTraking
) => {
  const io = getIO();
  let rate: number | null = null;

  if (msg?.message?.conversation || msg?.message?.extendedTextMessage) {
    rate = parseInt(msg.message.conversation || msg.message.extendedTextMessage.text , 10) || null;
  }

  if (!Number.isNaN(rate) && Number.isInteger(rate) && !isNull(rate)) {
    const whatsapp = await ShowWhatsAppService(
      ticket.whatsappId,
      ticket.companyId
    );

    let finalRate = rate;

    if (rate < 1) {
      finalRate = 1;
    }
    if (rate > 5) {
      finalRate = 5;
    }

    await UserRating.create({
      ticketId: ticketTraking.ticketId,
      companyId: ticketTraking.companyId,
      userId: ticketTraking.userId,
      rate: finalRate,
    });

    const complationMessage = whatsapp.complationMessage.trim() || "Atendimento finalizado";
    const body = formatBody(`${complationMessage}`, ticket.contact);
    await SendWhatsAppMessage({ body, ticket });

    await ticketTraking.update({
      finishedAt: moment().toDate(),
      rated: true,
    });

    const keepUserAndQueue =
      (await GetCompanySetting(
        ticket.companyId,
        "keepUserAndQueue",
        "enabled"
      )) === "enabled";

    await ticket.update({
      queueId: keepUserAndQueue ? ticket.queueId : null,
      chatbot: null,
      queueOptionId: null,
      userId: keepUserAndQueue ? ticket.userId : null,
      status: "closed",
    });

    io.to(`company-${ticket.companyId}-open`)
      .to(`queue-${ticket.queueId}-open`)
      .emit(`company-${ticket.companyId}-ticket`, {
        action: "delete",
        ticket,
        ticketId: ticket.id,
      });

    io.to(`company-${ticket.companyId}-${ticket.status}`)
      .to(`queue-${ticket.queueId}-${ticket.status}`)
      .to(ticket.id.toString())
      .emit(`company-${ticket.companyId}-ticket`, {
        action: "update",
        ticket,
        ticketId: ticket.id,
      });

  }

};

const handleChartbot = async (ticket: Ticket, msg: WAMessage, wbot: Session, dontReadTheFirstQuestion = false) => {
  const queue = await Queue.findByPk(ticket.queueId, {
    include: [
      {
        model: QueueOption,
        as: "options",
        where: { parentId: null },
      },
    ],
    order: [
      ["options", "option", "ASC"],
    ]
  });

  const messageBody = getBodyMessage(msg);

  if (messageBody === "#") {
    // voltar para o menu inicial
    await ticket.update({ queueOptionId: null, chatbot: false, queueId: null });
    await verifyQueue(wbot, msg, ticket, ticket.contact);
    return;
  }

  // voltar para o menu anterior
  if (!isNil(queue) && !isNil(ticket.queueOptionId) && messageBody === "#") {
    const option = await QueueOption.findByPk(ticket.queueOptionId);
    await ticket.update({ queueOptionId: option?.parentId });

    // escolheu uma opção
  } else if (!isNil(queue) && !isNil(ticket.queueOptionId)) {
    const count = await QueueOption.count({
      where: { parentId: ticket.queueOptionId },
    });
    let option: QueueOption = null;
    if (count === 1) {
      option = await QueueOption.findOne({
        where: { parentId: ticket.queueOptionId },
      });
    } else {
      option = await QueueOption.findOne({
        where: {
          option: messageBody || "",
          parentId: ticket.queueOptionId,
        },
      });
    }
    if (option) {
      await ticket.update({ queueOptionId: option?.id });
      // if (option.mediaPath !== null && option.mediaPath !== "")  {

      //   const filePath = path.resolve("public", option.mediaPath);


      //   const optionsMsg = await getMessageOptions(option.mediaName, filePath);

      //   let sentMessage = await wbot.sendMessage(`${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`, { ...optionsMsg });

      //   await verifyMediaMessage(sentMessage, ticket, ticket.contact);
      // }
    }

    // não linha a primeira pergunta
  } else if (!isNil(queue) && isNil(ticket.queueOptionId) && !dontReadTheFirstQuestion) {
    const option = queue?.options.find((o) => o.option === messageBody);
    if (option) {
      await ticket.update({ queueOptionId: option?.id });
    } else if (await GetCompanySetting(ticket.companyId, "chatbotAutoExit", "disabled") === "enabled" ) {
      // message didn't identified an option and company setting to exit chatbot
      await ticket.update({ chatbot: false });
      const whatsapp = await Whatsapp.findByPk(ticket.whatsappId);
      const contact = await Contact.findByPk(ticket.contactId);
      if (whatsapp.transferMessage) {
        const body = formatBody(`${whatsapp.transferMessage}`, contact);
        await SendWhatsAppMessage({ body, ticket });        
      }
    }
  }

  await ticket.reload();

  /* * /
  if (!isNil(queue) && isNil(ticket.queueOptionId)) {
    sendMenu(wbot, ticket, queue);
  } else /* */ if (!isNil(queue) && !isNil(ticket.queueOptionId)) {
    const currentOption = await QueueOption.findByPk(ticket.queueOptionId, {
      include: [
        {
          model: Queue,
          as: "forwardQueue",
          include: [{
            model: QueueOption,
            as: "options",
            where: { parentId: null },
            required: false,
          }]
        },
        {
          model: QueueOption,
          as: "options",
          required: false,
        }
      ],
      order: [
        [Sequelize.cast(Sequelize.col("forwardQueue.options.option"), "INTEGER"), "ASC"],
        [Sequelize.cast(Sequelize.col("options.option"), "INTEGER"), "ASC"]
      ]
    });

    let filePath = null;
    let optionsMsg = null;
    if (currentOption.mediaPath !== null && currentOption.mediaPath !== "") {
      filePath = path.resolve("public", currentOption.mediaPath);
      optionsMsg = await getMessageOptions(currentOption.mediaName, filePath);
    }

    if (currentOption.exitChatbot || currentOption.forwardQueueId) {
      const text = formatBody(`${currentOption.message}`, ticket.contact);

      if (filePath) {
        optionsMsg.caption = text;
        const sentMessage = await wbot.sendMessage(`${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`, { ...optionsMsg });
        await verifyMediaMessage(sentMessage, ticket, ticket.contact);
      } else {
        const sendMsg = await wbot.sendMessage(
          `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
          { text }
        );
        await verifyMessage(sendMsg, ticket, ticket.contact);
      }

      if (currentOption.exitChatbot) {
        await ticket.update({
          chatbot: false,
          queueOptionId: null,
        });
      } else if (currentOption.forwardQueueId) {
        await ticket.update({
          queueOptionId: null,
          chatbot: false,
          queueId: currentOption.forwardQueueId,
        });
        await ticket.reload();
        startQueue(wbot, ticket, currentOption.forwardQueue);
      }
      return;
    }

    if (filePath) {
      const sentMessage = await wbot.sendMessage(`${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`, { ...optionsMsg });
      await verifyMediaMessage(sentMessage, ticket, ticket.contact);
    }

    if (currentOption.options.length > -1) {
      sendMenu(wbot, ticket, currentOption);
    }
  }
}

const handleMessage = async (
  msg: proto.IWebMessageInfo,
  wbot: Session,
  companyId: number
): Promise<void> => {
  if (!isValidMsg(msg)) return;

  if (msg.message?.ephemeralMessage) {
    msg.message = msg.message.ephemeralMessage.message;
  }

  try {
    let msgContact: IMe;
    let groupContact: Contact | undefined;

    const isGroup = msg.key.remoteJid?.endsWith("@g.us");

    if (isGroup) {
      const msgIsGroupBlock = await Setting.findOne({
        where: {
          companyId,
          key: "CheckMsgIsGroup",
        },
      });
      
      if ( !msgIsGroupBlock || msgIsGroupBlock.value === "enabled") {
        return;
      }
    }

    const bodyMessage = getBodyMessage(msg);
    const msgType = getTypeMessage(msg);

    const unpackedMessage = getUnpackedMessage(msg);
    const messageMedia = getMessageMedia(unpackedMessage);
    if (msg.key.fromMe) {
      if (bodyMessage?.startsWith("\u200e")) return;

      if (
        !messageMedia &&
        msgType !== "conversation" &&
        msgType !== "extendedTextMessage" &&
        msgType !== "vcard"
      )
        return;
      msgContact = await getContactMessage(msg, wbot);
    } else {
      msgContact = await getContactMessage(msg, wbot);
    }

    if (isGroup) {
      groupContact = await wbotMutex.runExclusive(async () => {
        let result = groupContactCache.get(msg.key.remoteJid);
        if (!result) {
          const groupMetadata = await wbot.groupMetadata(msg.key.remoteJid);
          const msgGroupContact = {
            id: groupMetadata.id,
            name: groupMetadata.subject,
          }
          result = await verifyContact(msgGroupContact, wbot, companyId);
          groupContactCache.set(msg.key.remoteJid, result);
        }
        return result;
      });      
    }

    const whatsapp = await ShowWhatsAppService(wbot.id!, companyId);
    const contact = await verifyContact(msgContact, wbot, companyId);

    let unreadMessages = 0;


    if (msg.key.fromMe) {
      await cacheLayer.set(`contacts:${contact.id}:unreads`, "0");
    } else {
      const unreads = await cacheLayer.get(`contacts:${contact.id}:unreads`);
      unreadMessages = +unreads + 1;
      await cacheLayer.set(
        `contacts:${contact.id}:unreads`,
        `${unreadMessages}`
      );
    }

    const lastMessage = await Message.findOne({
      where: {
        contactId: contact.id,
        companyId,
      },
      order: [["createdAt", "DESC"]],
    });

    const complationMessage = whatsapp.complationMessage.trim() || "Atendimento finalizado";

    if (unreadMessages === 0 && complationMessage && formatBody(complationMessage, contact).trim().toLowerCase() === lastMessage?.body.trim().toLowerCase()) {
      return;
    }

    if (!msg.key.fromMe && !contact.isGroup) {
      const userRatingEnabled = await GetCompanySetting(companyId, "userRating", "") === "enabled"

      const ticketTracking = userRatingEnabled && await TicketTraking.findOne({
        where: {
          whatsappId: whatsapp.id,
          rated: false,
          ratingAt: { [Op.not]: null },
          finishedAt: null
        },
        include: [{
          model: Ticket,
          where: {
            status: "open",
            contactId: contact.id,
          },
          include: [
            {
              model: Contact
            },
            {
              model: User
            },
            {
              model: Queue
            }
          ]
        }]
      });

      if (ticketTracking) {
        try {
          /**
           * Tratamento para avaliação do atendente
           */

          // insistir a responder avaliação
          const rate = Number(bodyMessage);

          if (!Number.isFinite(rate)) {
            const debouncedSentMessage = debounce(
              async () => {
                await wbot.sendMessage(
                  `${ticketTracking.ticket.contact.number}@${ticketTracking.ticket.isGroup ? "g.us" : "s.whatsapp.net"
                  }`,
                  {
                    text: "\n*Por favor avalie nosso atendimento com uma nota de 1 a 5*"
                  }
                );
              },
              1000,
              ticketTracking.ticket.id
            );
            debouncedSentMessage();
            return;
          }
          // dev Ricardo

          if (verifyRating(ticketTracking)) {
            handleRating(msg, ticketTracking.ticket, ticketTracking);
            return;
          }
        } catch (e) {
          Sentry.captureException(e);
          console.log(e);
        }

      }
    }

    const { ticket, justCreated } = await createTicketMutex.runExclusive(async () => {
      const result = await FindOrCreateTicketService(contact, wbot.id!, unreadMessages, companyId, groupContact);
      return result;
    });

    // voltar para o menu inicial

    if (bodyMessage === "#" && !isGroup) {
      await ticket.update({
        queueOptionId: null,
        chatbot: false,
        queueId: null,
      });
      await verifyQueue(wbot, msg, ticket, ticket.contact);
      return;
    }


    if (messageMedia || msg?.message?.extendedTextMessage?.thumbnailDirectPath) {
      await verifyMediaMessage(msg, ticket, contact, wbot, messageMedia);
    } else if (msg.message?.editedMessage?.message?.protocolMessage?.editedMessage) {
      // message edited by Whatsapp App
      await verifyEditedMessage(msg.message.editedMessage.message.protocolMessage.editedMessage, ticket, msg.message.editedMessage.message.protocolMessage.key.id);
    } else if (msg.message?.protocolMessage?.editedMessage) {
      // message edited by Whatsapp Web
      await verifyEditedMessage(msg.message.protocolMessage.editedMessage, ticket, msg.message.protocolMessage.key.id);
    } else if (msg.message?.protocolMessage?.type === 0) {
      await verifyDeleteMessage(msg.message.protocolMessage, ticket);
    } else {
      await verifyMessage(msg, ticket, contact);
    }
    
    if (isGroup || contact.disableBot) {
      return;
    }

    const scheduleType = await Setting.findOne({
      where: {
        companyId,
        key: "scheduleType"
      }
    });


    try {
      if (!msg.key.fromMe && scheduleType) {
        let currentSchedule: ScheduleResult = null;
        if (scheduleType.value === "company") {
          currentSchedule = await VerifyCurrentSchedule(companyId);
        }
        /**
         * Tratamento para envio de mensagem quando a empresa está fora do expediente
         */
        if (
          scheduleType.value === "company" &&
          !isNil(currentSchedule) &&
          (!currentSchedule || currentSchedule.inActivity === false)
        ) {
          const body = `${whatsapp.outOfHoursMessage.trim() || "Estamos fora do horário de expediente"}`;

          const debouncedSentMessage = debounce(
            async () => {
              await wbot.sendMessage(
                `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"
                }`,
                {
                  text: `${body}`
                }
              );
            },
            3000,
            ticket.id
          );
          debouncedSentMessage();
          return;
        }

        if (scheduleType.value === "queue" && ticket.queueId !== null) {
          /**
           * Tratamento para envio de mensagem quando a fila está fora do expediente
           */
          if (scheduleType.value === "queue") {
            currentSchedule = await VerifyCurrentSchedule(companyId, ticket.queueId);
          }
          const queue = await Queue.findByPk(ticket.queueId);

          if (
            !isNil(currentSchedule) &&
            (!currentSchedule || currentSchedule.inActivity === false)
          ) {
            const outOfHoursMessage = queue.outOfHoursMessage?.trim() || "Estamos fora do horário de expediente";
            const body = `${outOfHoursMessage}`;
            const debouncedSentMessage = debounce(
              async () => {
                await wbot.sendMessage(
                  `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"
                  }`,
                  {
                    text: `${body}`
                  }
                );
              },
              3000,
              ticket.id
            );
            debouncedSentMessage();
            return;
          }
        }

      }
    } catch (e) {
      Sentry.captureException(e);
      console.log(e);
    }

    if (
      !ticket.queue &&
      !isGroup &&
      !msg.key.fromMe &&
      !ticket.userId &&
      whatsapp.queues.length >= 1
    ) {
      await verifyQueue(wbot, msg, ticket, ticket.contact);

    }

    const dontReadTheFirstQuestion = ticket.queue === null;

    await ticket.reload();

    try {
      // Fluxo fora do expediente
      if (!msg.key.fromMe && scheduleType.value === "queue" && ticket.queueId !== null) {
          /**
           * Tratamento para envio de mensagem quando a fila está fora do expediente
           */
          const currentSchedule = await VerifyCurrentSchedule(companyId, ticket.queueId);
          const queue = await Queue.findByPk(ticket.queueId);

          if (
            !isNil(currentSchedule) &&
            (!currentSchedule || currentSchedule.inActivity === false)
          ) {
            const outOfHoursMessage = queue.outOfHoursMessage?.trim() || "Estamos fora do horário de expediente";
            const body = `${outOfHoursMessage}`;
            const debouncedSentMessage = debounce(
              async () => {
                await wbot.sendMessage(
                  `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"
                  }`,
                  {
                    text: `${body}`
                  }
                );
              },
              3000,
              ticket.id
            );
            debouncedSentMessage();
            return;
          }
      }
    } catch (e) {
      Sentry.captureException(e);
      console.log(e);
    }

    if (
      justCreated &&
      !whatsapp?.queues?.length &&
      !ticket.userId &&
      !isGroup &&
      !msg.key.fromMe
    ) {
      const message = await Message.findOne({
        where: {
          ticketId: ticket.id,
          fromMe: true
        },
        order: [["createdAt", "DESC"]]
      });

      if (message && message.body.includes(whatsapp.greetingMessage)) {
        return;
      }

      if (whatsapp.greetingMessage) {

        const debouncedSentMessage = debounce(
          async () => {
            await wbot.sendMessage(
              `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"
              }`,
              {
                text: formatBody(`${whatsapp.greetingMessage}`, contact, ticket)
              }
            );
          },
          1000,
          ticket.id
        );
        debouncedSentMessage();
        return;
      }

    }


    if (whatsapp.queues.length === 1 && ticket.queue) {
      if (ticket.chatbot && !msg.key.fromMe) {
        await handleChartbot(ticket, msg, wbot, dontReadTheFirstQuestion);
      }
    }
    if (whatsapp.queues.length > 1 && ticket.queue) {
      if (ticket.chatbot && !msg.key.fromMe) {
        await handleChartbot(ticket, msg, wbot, dontReadTheFirstQuestion);
      }
    }

  } catch (err) {
    console.log(err)
    Sentry.captureException(err);
    logger.error(`Error handling whatsapp message: Err: ${err}`);
  }
};

const handleMsgAck = async (
  msg: WAMessage,
  ack: number
) => {
  if (!ack) return;

  const io = getIO();

  try {
    const messageToUpdate = await Message.findByPk(msg.key.id, {
      include: [
        "contact",
        {
          model: Message,
          as: "quotedMsg",
          include: ["contact"],
        },
      ],
    });

    if (!messageToUpdate || ack <= messageToUpdate.ack ) return;

    await messageToUpdate.update({ ack });
    io.to(messageToUpdate.ticketId.toString()).emit(
      `company-${messageToUpdate.companyId}-appMessage`,
      {
        action: "update",
        message: messageToUpdate,
      }
    );
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`Error handling message ack. Err: ${err}`);
  }
};

const verifyRecentCampaign = async (
  message: proto.IWebMessageInfo,
  companyId: number
) => {
  if (!message.key.fromMe) {
    const number = message.key.remoteJid.replace(/\D/g, "");
    const campaigns = await Campaign.findAll({
      where: { companyId, status: "EM_ANDAMENTO", confirmation: true },
    });
    if (campaigns) {
      const ids = campaigns.map((c) => c.id);
      const campaignShipping = await CampaignShipping.findOne({
        where: { campaignId: { [Op.in]: ids }, number, confirmation: null },
      });

      if (campaignShipping) {
        await campaignShipping.update({
          confirmedAt: moment(),
          confirmation: true,
        });
        await campaignQueue.add(
          "DispatchCampaign",
          {
            campaignShippingId: campaignShipping.id,
            campaignId: campaignShipping.campaignId,
          },
          {
            delay: parseToMilliseconds(randomValue(0, 10)),
          }
        );
        return true;
      }
    }
  }
  return false;
};

const filterMessages = (msg: WAMessage): boolean => {
  // receiving edited message
  if (msg.message?.protocolMessage?.editedMessage) return true;
  // receiving message deletion info
  if (msg.message?.protocolMessage?.type === 0) return true;
  // ignore other protocolMessages
  if (msg.message?.protocolMessage) return false;

  if (
    [
      WAMessageStubType.REVOKE,
      WAMessageStubType.E2E_DEVICE_CHANGED,
      WAMessageStubType.E2E_IDENTITY_CHANGED,
      WAMessageStubType.CIPHERTEXT
    ].includes(msg.messageStubType as WAMessageStubType)
  )
    return false;

  return true;
};

export const sendMessageImage = async (
  wbot: Session,
  contact: Contact,
  ticket: Ticket,
  url: string,
  caption: string
) => {

  let sentMessage: proto.IWebMessageInfo
  try {
    sentMessage = await wbot.sendMessage(
      `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
      {
        image: url ? { url } : fs.readFileSync(`public/temp/${caption}-${makeid(10)}`),
        fileName: caption,
        caption,
        mimetype: "image/jpeg"
      }
    );
  } catch (error) {
    sentMessage = await wbot.sendMessage(
      `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
      {
        text: formatBody("Não consegui enviar o PDF, tente novamente!", contact)
      }
    );
  }
  verifyMessage(sentMessage, ticket, contact);
};

export const sendMessageLink = async (
  wbot: Session,
  contact: Contact,
  ticket: Ticket,
  url: string,
  caption: string
) => {

  let sentMessage: proto.IWebMessageInfo
  try {
    sentMessage = await wbot.sendMessage(
      `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`, {
      document: url ? { url } : fs.readFileSync(`public/temp/${caption}-${makeid(10)}`),
      fileName: caption,
      caption,
      mimetype: "application/pdf"
    }
    );
  } catch (error) {
    sentMessage = await wbot.sendMessage(
      `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`, {
      text: formatBody("Não consegui enviar o PDF, tente novamente!", contact)
    }
    );
  }
  verifyMessage(sentMessage, ticket, contact);
};

const wbotMessageListener = async (wbot: Session, companyId: number): Promise<void> => {
  try {
    wbot.ev.on("messages.upsert", async (messageUpsert: ImessageUpsert) => {
      const messages = messageUpsert.messages
        .filter(filterMessages)
        .map(msg => msg);

      if (!messages) return;

      messages.forEach(async (message: proto.IWebMessageInfo) => {
        const messageExists = await Message.count({
          where: { id: message.key.id!, companyId }
        });


        if (!messageExists) {

          if (await verifyRecentCampaign(message, companyId)) {
            return;
          }
          await handleMessage(message, wbot, companyId);
        }
      });
    });

    wbot.ev.on("messages.update", (messageUpdate: WAMessageUpdate[]) => {

      if (messageUpdate.length === 0) return;
      messageUpdate.forEach(async (message: WAMessageUpdate) => {
        (wbot as WASocket)!.readMessages([message.key])

        await ackMutex.runExclusive(async () => {
          handleMsgAck(message, message.update.status);
        });
      });
    });

  } catch (error) {
    Sentry.captureException(error);
    logger.error(`Error handling wbot message listener. Err: ${error}`);
  }
};

export { wbotMessageListener, handleMessage };
