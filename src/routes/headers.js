import express from "express";
import { pb, pbAdmin, ITEMS_PER_PAGE } from "../config.js";
import { requireLogin } from "../middleware.js";
import { getUserHeaders, getHeaderForEdit, logAuditEvent } from "../utils.js";

const router = express.Router();

router.get("/", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const initialPage = 1;
    const initialSort = "-updated";

    const resultList = await pb.collection("headers").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: `owner = '${userId}'`,
      fields: "id,name,updated",
    });

    res.render("headers/index", {
      headers: resultList.items,
      pageTitle: "Manage Headers",
      pagination: {
        page: resultList.page,
        perPage: resultList.perPage,
        totalItems: resultList.totalItems,
        totalPages: resultList.totalPages,
      },
      initialSort: initialSort,
      message: req.query.message,
      error: req.query.error,
    });
  } catch (error) {
    console.error("Error fetching headers for management page:", error);
    res.render("headers/index", {
      headers: [],
      pageTitle: "Manage Headers",
      pagination: { page: 1, perPage: ITEMS_PER_PAGE, totalItems: 0, totalPages: 0 },
      initialSort: "-updated",
      error: "Could not load headers.",
    });
  }
});

router.get("/new", requireLogin, (req, res) => {
  res.render("headers/new", {
    header: null,
    errors: null,
    pageTitle: "Create New Header",
  });
});

router.post("/new", requireLogin, async (req, res) => {
  const { name, content } = req.body;
  const userId = req.session.user.id;
  const errors = {};

  if (!name || name.trim() === "") errors.name = { message: "Name is required." };
  if (!content || content.trim() === "") errors.content = { message: "Content is required." };

  if (Object.keys(errors).length > 0) {
    return res.status(400).render("headers/new", {
      header: { name, content },
      errors: errors,
      pageTitle: "Create New Header",
    });
  }

  const data = {
    name: name.trim(),
    content: content,
    owner: userId,
  };

  try {
    const newHeader = await pb.collection("headers").create(data);
    logAuditEvent(req, "HEADER_CREATE", "headers", newHeader.id, { name: newHeader.name });
    res.redirect("/headers?message=created");
  } catch (error) {
    console.error("Failed to create header:", error);
    logAuditEvent(req, "HEADER_CREATE_FAILURE", "headers", null, { error: error?.message, data });
    const creationErrors = error?.data?.data || { general: "Failed to create header. Please try again." };
    res.status(400).render("headers/new", {
      header: data,
      errors: creationErrors,
      pageTitle: "Create New Header",
    });
  }
});

router.get("/edit/:id", requireLogin, async (req, res, next) => {
  const headerId = req.params.id;
  const userId = req.session.user.id;

  try {
    const header = await getHeaderForEdit(headerId, userId);
    res.render("headers/edit", {
      header: header,
      errors: null,
      pageTitle: "Edit Header",
    });
  } catch (error) {
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    console.error(`Failed to fetch header ${headerId} for edit:`, error);
    next(error);
  }
});

router.post("/edit/:id", requireLogin, async (req, res, next) => {
  const headerId = req.params.id;
  const userId = req.session.user.id;
  const { name, content } = req.body;
  const errors = {};

  if (!name || name.trim() === "") errors.name = { message: "Name is required." };
  if (!content || content.trim() === "") errors.content = { message: "Content is required." };

  if (Object.keys(errors).length > 0) {
    try {
      const originalHeader = await getHeaderForEdit(headerId, userId);
      return res.status(400).render("headers/edit", {
        header: { ...originalHeader, name, content },
        errors: errors,
        pageTitle: "Edit Header",
      });
    } catch (fetchError) {
      return next(fetchError);
    }
  }

  const data = {
    name: name.trim(),
    content: content,
  };

  try {
    const updatedHeader = await pb.collection("headers").update(headerId, data);
    logAuditEvent(req, "HEADER_UPDATE", "headers", updatedHeader.id, { name: updatedHeader.name });
    res.redirect("/headers?message=updated");
  } catch (error) {
    console.error(`Failed to update header ${headerId}:`, error);
    logAuditEvent(req, "HEADER_UPDATE_FAILURE", "headers", headerId, { error: error?.message, data });

    if (error.status === 403 || error.status === 404) {
      return next(error);
    }

    const updateErrors = error?.data?.data || { general: "Failed to update header. Please try again." };
    try {
      const originalHeader = await getHeaderForEdit(headerId, userId);
      res.status(400).render("headers/edit", {
        header: { ...originalHeader, name, content },
        errors: updateErrors,
        pageTitle: "Edit Header",
      });
    } catch (fetchError) {
      next(fetchError);
    }
  }
});

router.post("/delete/:id", requireLogin, async (req, res, next) => {
  const headerId = req.params.id;
  const userId = req.session.user.id;
  let headerName = headerId;

  try {
    const header = await getHeaderForEdit(headerId, userId);
    headerName = header.name;

    await pb.collection("headers").delete(headerId);
    logAuditEvent(req, "HEADER_DELETE", "headers", headerId, { name: headerName });

    res.redirect("/headers?message=deleted");
  } catch (error) {
    console.error(`Failed to delete header ${headerId}:`, error);
    logAuditEvent(req, "HEADER_DELETE_FAILURE", "headers", headerId, { name: headerName, error: error?.message });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect("/headers?error=delete_failed");
  }
});

export default router;
