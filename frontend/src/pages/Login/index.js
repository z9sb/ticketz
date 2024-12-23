import {
  Box,
  Button,
  TextField,
  InputAdornment,
  IconButton,
} from "@mui/material";
import { FaUser, FaRegEye, FaRegEyeSlash } from "react-icons/fa";
import React, { useState, useContext, useEffect } from "react";
import { i18n } from "../../translate/i18n";
import useSettings from "../../hooks/useSettings";
import { AuthContext } from "../../context/Auth/AuthContext";

const Login = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [allowSignup, setAllowSignup] = useState(false);
  const { handleLogin } = useContext(AuthContext);
  const { getPublicSetting } = useSettings();
  const [data, setData] = useState({
    email: {
      value: "",
      error: null,
      helperText: null,
    },
    password: {
      value: "",
      error: null,
      helperText: null,
    },
    confirmEmail: null,
  });

  const handlSubmit = (e) => {
    e.preventDefault();

    let isValid = true;

    if (!data.email.value) {
      setData((prevData) => ({
        ...prevData,
        email: {
          ...prevData.email,
          error: "Required",
          helperText: i18n.t("login.form.requiredEmail"),
        },
      }));
      isValid = false;
    } else if (
      !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}$/i.test(data.email.value)
    ) {
      setData((prevData) => ({
        ...prevData,
        email: {
          ...prevData.email,
          error: "Invalid email",
          helperText: i18n.t("login.form.invalidEmail"),
        },
      }));
      isValid = false;
    }

    if (!data.password.value || !data.password.value.trim()) {
      setData((prevData) => ({
        ...prevData,
        password: {
          ...prevData.password,
          error: "Required",
          helperText: i18n.t("login.form.requiredPassword"),
        },
      }));
      isValid = false;
    }

    if (isValid) {
      handleLogin({ email: data.email.value, password: data.password.value });
    }
  };

  useEffect(() => {
    getPublicSetting("allowSignup")
      .then((data) => {
        setAllowSignup(data === "enabled");
      })
      .catch((error) => {
        console.log("Error reading setting", error);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        height: "100vh",
        backgroundColor: "#90CAF9",
        width: "100%",
        padding: "50px",
      }}
    >
      <Box
        sx={{
          width: { xs: "0%", sm: "60%" },
          left: 0,
          height: "100%",
          background: "linear-gradient(to right, #2979ff, #90CAF9)",
          justifyContent: "center",
          display: { xs: "none", sm: "flex" },
          alignItems: "center",
          boxShadow: "0px 10px 10px rgba(0, 0, 0, 0.2)",
          position: "relative",
          borderRadius: "20px 0 0 20px",
        }}
      >
        <Box
          sx={{
            display: "flex",
            gap: "12px",
          }}
        >
          <Box
            sx={{
              width: "60px",
              height: "250px",
              backgroundColor: "#2979ff",
              borderRadius: "4px",
              boxShadow: "0px 4px 10px rgba(41, 121, 255, 0.6)",
              transform: "scale(1.1)",
              ":hover": {
                transform: "scale(1.3)",
                transition: "transform 0.3s ease-in-out",
              },
            }}
          />
          <Box
            sx={{
              width: "60px",
              height: "250px",
              backgroundColor: "#5393ff",
              borderRadius: "4px",
              boxShadow: "0px 4px 10px rgba(92, 158, 255, 0.6)",
              transform: "scale(1.1)",
              ":hover": {
                transform: "scale(1.3)",
                transition: "transform 0.3s ease-in-out",
              },
            }}
          />
          <Box
            sx={{
              width: "60px",
              height: "250px",
              borderRadius: "4px",
              backgroundColor: "#90CAF9",
              boxShadow: "0px 4px 10px rgba(41, 121, 255, 0.6)",
              transform: "scale(1.1)",
              ":hover": {
                transform: "scale(1.3)",
                transition: "transform 0.3s ease-in-out",
              },
            }}
          />
        </Box>
      </Box>
      <Box
        sx={{
          textAlign: "center",
          border: "0",
          borderRadius: {
            xs: "20px",
            sm: "0 20px 20px 0",
          },
          width: { xs: "100%", sm: "100%" },
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: "50px",
          backgroundColor: "#F8F8F8",
          boxShadow: "0px 10px 10px rgba(0, 0, 0, 0.2)",
        }}
      >
        <Box
          component="img"
          src="/vector/logo.svg"
          alt="logo"
          sx={{ width: { xs: "70%", sm: "35%" } }}
        />
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            justifyContent: "center",
            alignItems: "center",
            width: "100%",
          }}
        >
          <TextField
            type="text"
            placeholder={i18n.t("login.form.email")}
            variant="standard"
            value={data.email.value}
            helperText={data.email.helperText}
            onChange={(e) =>
              setData({ ...data, email: { value: e.target.value } })
            }
            sx={{ width: "70%", height: "20px" }}
            InputProps={{
              style: { height: "50px" },
              endAdornment: (
                <InputAdornment position="end">
                  <FaUser
                    size={20}
                    color="#ccc"
                    style={{ marginRight: "10px" }}
                  />
                </InputAdornment>
              ),
            }}
          />

          <TextField
            placeholder={i18n.t("login.form.password")}
            type={showPassword ? "text" : "password"}
            variant="standard"
            value={data.password.value}
			helperText={data.password.helperText}
            onChange={(e) =>
              setData({ ...data, password: { value: e.target.value } })
            }
            sx={{ width: "70%" }}
            InputProps={{
              style: { height: "50px" },
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? (
                      <FaRegEyeSlash size={20} color="#ccc" />
                    ) : (
                      <FaRegEye size={20} color="#ccc" />
                    )}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
        </Box>

        <Button
          onClick={handlSubmit}
          variant="contained"
          color="primary"
          sx={{
            width: "70%",
            marginTop: "10px",
            backgroundColor: "",
            height: "50px",
          }}
        >
          {i18n.t("login.buttons.submit")}
        </Button>
      </Box>
    </Box>
  );
};

export default Login;
