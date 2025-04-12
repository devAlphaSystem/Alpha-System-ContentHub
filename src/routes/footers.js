import express from "express";
import { pb, pbAdmin, ITEMS_PER_PAGE } from "../config.js";
import { requireLogin } from "../middleware.js";
import { getUserFooters, getFooterForEdit, logAuditEvent } from "../utils.js";

const router = express.Router();

router.get("/", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const initialPage = 1;
    const initialSort = "-updated";

    const resultList = await pb.collection("footers").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: `owner = '${userId}'`,
      fields: "id,name,updated",
    });

    res.render("footers/index", {
      footers: resultList.items,
      pageTitle: "Manage Footers",
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
    console.error("Error fetching footers for management page:", error);
    res.render("footers/index", {
      footers: [],
      pageTitle: "Manage Footers",
      pagination: { page: 1, perPage: ITEMS_PER_PAGE, totalItems: 0, totalPages: 0 },
      initialSort: "-updated",
      error: "Could not load footers.",
    });
  }
});

router.get("/new", requireLogin, (req, res) => {
  res.render("footers/new", {
    footer: null,
    errors: null,
    pageTitle: "Create New Footer",
  });
});

router.post("/new", requireLogin, async (req, res) => {
  const { name, content } = req.body;
  const userId = req.session.user.id;
  const errors = {};

  if (!name || name.trim() === "") errors.name = { message: "Name is required." };
  if (!content || content.trim() === "") errors.content = { message: "Content is required." };

  if (Object.keys(errors).length > 0) {
    return res.status(400).render("footers/new", {
      footer: { name, content },
      errors: errors,
      pageTitle: "Create New Footer",
    });
  }

  const data = {
    name: name.trim(),
    content: content,
    owner: userId,
  };

  try {
    const newFooter = await pb.collection("footers").create(data);
    logAuditEvent(req, "FOOTER_CREATE", "footers", newFooter.id, { name: newFooter.name });
    res.redirect("/footers?message=created");
  } catch (error) {
    console.error("Failed to create footer:", error);
    logAuditEvent(req, "FOOTER_CREATE_FAILURE", "footers", null, { error: error?.message, data });
    const creationErrors = error?.data?.data || { general: "Failed to create footer. Please try again." };
    res.status(400).render("footers/new", {
      footer: data,
      errors: creationErrors,
      pageTitle: "Create New Footer",
    });
  }
});

router.get("/edit/:id", requireLogin, async (req, res, next) => {
  const footerId = req.params.id;
  const userId = req.session.user.id;

  try {
    const footer = await getFooterForEdit(footerId, userId);
    res.render("footers/edit", {
      footer: footer,
      errors: null,
      pageTitle: "Edit Footer",
    });
  } catch (error) {
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    console.error(`Failed to fetch footer ${footerId} for edit:`, error);
    next(error);
  }
});

router.post("/edit/:id", requireLogin, async (req, res, next) => {
  const footerId = req.params.id;
  const userId = req.session.user.id;
  const { name, content } = req.body;
  const errors = {};

  if (!name || name.trim() === "") errors.name = { message: "Name is required." };
  if (!content || content.trim() === "") errors.content = { message: "Content is required." };

  if (Object.keys(errors).length > 0) {
    try {
      const originalFooter = await getFooterForEdit(footerId, userId);
      return res.status(400).render("footers/edit", {
        footer: { ...originalFooter, name, content },
        errors: errors,
        pageTitle: "Edit Footer",
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
    const updatedFooter = await pb.collection("footers").update(footerId, data);
    logAuditEvent(req, "FOOTER_UPDATE", "footers", updatedFooter.id, { name: updatedFooter.name });
    res.redirect("/footers?message=updated");
  } catch (error) {
    console.error(`Failed to update footer ${footerId}:`, error);
    logAuditEvent(req, "FOOTER_UPDATE_FAILURE", "footers", footerId, { error: error?.message, data });

    if (error.status === 403 || error.status === 404) {
      return next(error);
    }

    const updateErrors = error?.data?.data || { general: "Failed to update footer. Please try again." };
    try {
      const originalFooter = await getFooterForEdit(footerId, userId);
      res.status(400).render("footers/edit", {
        footer: { ...originalFooter, name, content },
        errors: updateErrors,
        pageTitle: "Edit Footer",
      });
    } catch (fetchError) {
      next(fetchError);
    }
  }
});

router.post("/delete/:id", requireLogin, async (req, res, next) => {
  const footerId = req.params.id;
  const userId = req.session.user.id;
  let footerName = footerId;

  try {
    const footer = await getFooterForEdit(footerId, userId);
    footerName = footer.name;

    await pb.collection("footers").delete(footerId);
    logAuditEvent(req, "FOOTER_DELETE", "footers", footerId, { name: footerName });

    res.redirect("/footers?message=deleted");
  } catch (error) {
    console.error(`Failed to delete footer ${footerId}:`, error);
    logAuditEvent(req, "FOOTER_DELETE_FAILURE", "footers", footerId, { name: footerName, error: error?.message });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect("/footers?error=delete_failed");
  }
});

export default router;
