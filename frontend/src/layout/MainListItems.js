import {
  Box,
  Button,
  IconButton,
  Typography,
  Divider,
  AccordionSummary,
  AccordionDetails,
  Accordion,
} from "@mui/material";
import { RxDashboard } from "react-icons/rx";
import {
  TbUsers,
  TbSettings2,
  TbProgressHelp,
  TbSpeakerphone,
} from "react-icons/tb";
import { FaWhatsapp } from "react-icons/fa6";
import { Link as RouterLink } from "react-router-dom";
import {
  MdOutlineEdit,
  MdOutlineQuickreply,
  MdOutlineAnnouncement,
} from "react-icons/md";
import { RiContactsBook2Line, RiFileList3Line } from "react-icons/ri";
import { LuCalendarCheck2 } from "react-icons/lu";
import { TbTags } from "react-icons/tb";
import { PiChatsCircleBold, PiLinkBold  } from "react-icons/pi";
import { LuContact, LuSettings2 } from "react-icons/lu";
import { TiFlowMerge } from "react-icons/ti";
import { AiOutlineSwap  } from "react-icons/ai";
import { HiOutlineBanknotes } from "react-icons/hi2";
import { Can } from "../components/Can";
import { AuthContext } from "../context/Auth/AuthContext";
import { useContext } from "react";
import { i18n } from "../translate/i18n";
import { useState, useEffect } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

const IconCampaigs = ({ open, icon, text, to }) => {
  return (
    <Button
      startIcon={icon}
      component={RouterLink}
      to={to}
      variant="contained"
      color="inherit"
      fullWidth
      sx={{
        marginBottom: "10px",
        justifyContent: "flex-start",
        backgroundColor: "#fff",
        alignItems: "center",
        boxShadow: "none",
        marginLeft: open ? "18%" : "7px",
        transition: "margin-left 0.3s ease-in-out",
        borderRadius: "10px",
        width: "100%",
        backgroundColor: "transparent",
        ":hover": {
          boxShadow: "none",
          backgroundColor: "rgba(0, 0, 0, 0.04)"
        },
      }}
    >
      {open ? text : null}
    </Button>
  );
};

const Campaigns = ({ open }) => {
  return (
    <Box sx={{ maxWidth: open ? "250px" : "100px" }}>
      <Accordion
        fullWidth
        defaultExpanded
        color="inherit"
        sx={{
          display: "flex",
          flexDirection: "column",
          border: 0,
          boxShadow: "none",
          width: '80%',
          backgroundColor: "transparent",
          ":hover": {
            boxShadow: "none",

          },
        }}
      >
        <AccordionSummary
          expandIcon={open ? <ExpandMoreIcon /> : null}
          aria-controls="panel1a-content"
          id="panel1a-header"
          sx={{
            borderRadius: "10px",
            width: "100%",
            height: "50px",
            padding: open ? "" : "10px 20px",
            marginLeft: open ? "17%" : "15px",
            ":hover": {
              boxShadow: "none",
              backgroundColor: "rgba(0, 0, 0, 0.04)"
            },
          }}
        >
          <Box
            sx={{
              display: "flex",
              width: '100%',
              transition: "margin-left 0.3s ease-in-out",
              
            }}
          >
            <TbSpeakerphone size={25} />
            {open ? (
              <Typography sx={{ marginLeft: "10px" }}>
                {i18n.t("mainDrawer.listItems.campaigns")}
              </Typography>
            ) : null}
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ width: "100%" }}>
            <IconCampaigs
              to={"/campaigns"}
              open={open}
              icon={<RiFileList3Line  size={20} />}
              text={i18n.t("mainDrawer.listItems.campaignsList")}
            />
            <IconCampaigs
              to={"/contact-lists"}
              open={open}
              icon={<LuContact   size={20} />}
              text={i18n.t("mainDrawer.listItems.campaignsContacts")}
            />
            <IconCampaigs
              to={"/campaigns-config"}
              open={open}
              icon={<LuSettings2 size={20} />}
              text={i18n.t("mainDrawer.listItems.campaignsSettings")}
            />
          </Box>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};

const iconMenu = ({ icon, text, open, to }) => {
  return (
    <IconButton
      variant="text"
      color="inherit"
      component={RouterLink}
      to={to}
      sx={{
        borderRadius: "10px",
        width: "100%",
        height: "50px",
        padding: open ? "" : "10px 20px",
        justifyContent: "flex-start",
      }}
    >
      <Box
        sx={{
          display: "flex",
          marginLeft: open ? "18%" : "15px",
          transition: "margin-left 0.3s ease-in-out",
        }}
      >
        {icon}
        {open ? (
          <Typography sx={{ marginLeft: "10px" }}>{text}</Typography>
        ) : (
          ""
        )}
      </Box>
    </IconButton>
  );
};

const MainListItem = ({ setOpen, open }) => {
  const [showCampaigns, setShowCampaigns] = useState(false);
  
  useEffect(() => {
    if (localStorage.getItem("cshow")) {
      setShowCampaigns(true);
    }
  }, []);

  const { user, handleLogout } = useContext(AuthContext);
  return (
    <Box
      sx={{
        minWidth: open ? "250px" : "100px",
        display: "flex",
        flexDirection: "column",
        top: 0,
      }}
    >
      <Button
        variant="started"
        onClick={() => {
          setOpen(!open);
        }}
        sx={{
          width: "100%",
          display: "flex",
          height: "70px",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            transition: "margin-left 0.3s ease-in-out",
          }}
        >
          <img src="favicon.png" alt="logo" width={50} />
        </Box>
      </Button>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          justifyContent: "flex-start",
          alignItems: "center",
          overflowY: "auto",
          overflowX: "hidden",
          top: "",
          left: "0",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          paddingTop: { xs: "50px", md: "0px" },
        }}
      >
        {iconMenu({
          icon: <FaWhatsapp />,
          text: i18n.t("mainDrawer.listItems.tickets"),
          open,
          to: "/tickets",
        })}
        {iconMenu({
          icon: <MdOutlineEdit />,
          text: i18n.t("Tarefas"),
          open,
          to: "/todolist",
        })}
        {iconMenu({
          icon: <MdOutlineQuickreply />,
          text: i18n.t("mainDrawer.listItems.quickMessages"),
          open,
          to: "/quick-messages",
        })}
        {iconMenu({
          icon: <RiContactsBook2Line />,
          text: i18n.t("mainDrawer.listItems.contacts"),
          open,
          to: "/contacts",
        })}
        {iconMenu({
          icon: <LuCalendarCheck2 />,
          text: i18n.t("mainDrawer.listItems.schedules"),
          open,
          to: "/schedules",
        })}
        {iconMenu({
          icon: <TbTags />,
          text: i18n.t("mainDrawer.listItems.tags"),
          open,
          to: "/tags",
        })}
        {iconMenu({
          icon: <PiChatsCircleBold />,
          text: i18n.t("mainDrawer.listItems.chats"),
          open,
          to: "/chats",
        })}
        {iconMenu({
          icon: <TbProgressHelp />,
          text: i18n.t("mainDrawer.listItems.helps"),
          open,
          to: "/helps",
        })}
        <Can
          role={user.profile}
          perform="drawer-admin-items:view"
          yes={() => (
            <>
              <Box sx={{ flexGrow: 1, width: "70%" }}>
                <Divider />
              </Box>
              {iconMenu({
                icon: <RxDashboard />,
                text: i18n.t("mainDrawer.listItems.management"),
                open,
                to: "/",
              })}
              <Box sx={{ flexGrow: 1, width: "70%" }}>
                <Divider />
              </Box>

              { showCampaigns && <Campaigns open={open} />}
              {iconMenu({
                icon: <MdOutlineAnnouncement />,
                text: i18n.t("mainDrawer.listItems.annoucements"),
                open,
                to: "/announcements",
              })}
              {iconMenu({
                icon: <PiLinkBold />,
                text: i18n.t("mainDrawer.listItems.connections"),
                open,
                to: "/connections",
              })}
              {iconMenu({
                icon: <TiFlowMerge />,
                text: i18n.t("mainDrawer.listItems.queues"),
                open,
                to: "/organizations",
              })}
              {iconMenu({
                icon: <TbUsers />,
                text: i18n.t("mainDrawer.listItems.users"),
                open,
                to: "/users",
              })}
              {iconMenu({
                icon: <AiOutlineSwap />,
                text: i18n.t("mainDrawer.listItems.messagesAPI"),
                open,
                to: "/messages-api",
              })}
              {iconMenu({
                icon: <HiOutlineBanknotes />,
                text: i18n.t("mainDrawer.listItems.financeiro"),
                open,
                to: "/financeiro",
              })}
              {iconMenu({
                icon: <TbSettings2 />,
                text: i18n.t("mainDrawer.listItems.settings"),
                open,
                to: "/settings",
              })}
            </>
          )}
        ></Can>
      </Box>
    </Box>
  );
};

export default MainListItem;
