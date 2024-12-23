import { Box } from "@mui/material";

import MenuTop from "./menutop.js";
import { useState } from "react";
import MainListItem from "./MainListItems.js";

const LoggedInLayout = ({ children }) => {
  const [open, setOpen] = useState(true);
  return (
    <Box
      sx={{
        display: "flex",
        height: "100vh",
        overflowY: "hidden",
        transition: "width 0.5s ease-in-out",
        overflowX: "hidden",
      }}
    >
      <MainListItem setOpen={setOpen} open={open} />

      <Box sx={{ flexGrow: 1 }}>
        <MenuTop
          sx={{
            display: { sm: "none", md: "flex" },
            height: "30px",
            width: "100%",
            flexDirection: "column",
            justifyContent: "flex-end",
          }}
        />
        <Box
          sx={{
            height: "92%",
            overflow: "auto",
            transition: "width 0.5s ease-in-out",
            width: open ? "calc(100vw - 250px)" : "calc(100vw - 100px)",
            "&::-webkit-scrollbar": {
              width: "8px",
            },
            "&::-webkit-scrollbar-track": {
              backgroundColor: "#f0f0f0",
            },
            "&::-webkit-scrollbar-thumb": {
              backgroundColor: "#c1c1c1",
              borderRadius: "4px",
            },
            "&::-webkit-scrollbar-thumb:hover": {
              backgroundColor: "#a1a1a1",
            },
          }}
        >
          {children ? children : null}
        </Box>
      </Box>
    </Box>
  );
};

export default LoggedInLayout;
