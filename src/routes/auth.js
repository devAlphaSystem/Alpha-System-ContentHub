import express from "express";
import { pb, loginLimiter, NODE_ENV } from "../config.js";

const router = express.Router();

router.get("/login", (req, res) => {
  if (req.session.user) {
    return res.redirect("/");
  }
  res.render("login", { error: null, pageTitle: "Login" });
});

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).render("login", {
      error: "Email and password are required.",
      pageTitle: "Login",
    });
  }

  try {
    const authData = await pb.collection("users").authWithPassword(email, password);

    req.session.regenerate((err) => {
      if (err) {
        console.error("Session regeneration failed:", err);
        pb.authStore.clear();
        return res.status(500).render("login", {
          error: "Login failed due to a server issue. Please try again.",
          pageTitle: "Login",
        });
      }

      req.session.user = authData.record;
      req.session.token = authData.token;

      const cookie = pb.authStore.exportToCookie({
        secure: NODE_ENV === "production",
        httpOnly: true,
        sameSite: "Lax",
      });
      res.setHeader("Set-Cookie", cookie);

      const returnTo = req.session.returnTo || "/";
      req.session.returnTo = undefined;
      res.redirect(returnTo);
    });
  } catch (error) {
    console.error("Login failed:", error);
    let errorMessage = "Login failed. Please check your credentials.";
    if (error.status === 400) {
      errorMessage = "Invalid email or password.";
    }
    res.clearCookie("pb_auth");
    res.status(401).render("login", { error: errorMessage, pageTitle: "Login" });
  }
});

router.get("/logout", (req, res, next) => {
  pb.authStore.clear();
  res.clearCookie("pb_auth");

  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
      return res.redirect("/login");
    }
    res.redirect("/login");
  });
});

export default router;
