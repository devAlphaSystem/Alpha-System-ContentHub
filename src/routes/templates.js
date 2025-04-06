import express from "express";
import { pb, ITEMS_PER_PAGE } from "../config.js";
import { requireLogin } from "../middleware.js";
import { getTemplateForEdit } from "../utils.js";

const router = express.Router();

router.get("/", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const filter = `owner = '${userId}'`;
    const initialPage = 1;
    const initialSort = "-updated";

    const resultList = await pb.collection("templates").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
      fields: "id,name,updated",
    });

    res.render("templates/index", {
      templates: resultList.items,
      pageTitle: "Manage Templates",
      message: req.query.message,
      error: req.query.error,
      pagination: {
        page: resultList.page,
        perPage: resultList.perPage,
        totalItems: resultList.totalItems,
        totalPages: resultList.totalPages,
      },
      initialSort: initialSort,
    });
  } catch (error) {
    console.error("Error fetching templates:", error);
    res.render("templates/index", {
      templates: [],
      pageTitle: "Manage Templates",
      message: null,
      pagination: {
        page: 1,
        perPage: ITEMS_PER_PAGE,
        totalItems: 0,
        totalPages: 0,
      },
      initialSort: "-updated",
      error: "Could not load templates.",
    });
  }
});

router.get("/new", requireLogin, (req, res) => {
  res.render("templates/new", {
    template: null,
    errors: null,
    pageTitle: "Create New Template",
  });
});

router.post("/new", requireLogin, async (req, res) => {
  const { name, content } = req.body;
  const userId = req.session.user.id;

  const data = {
    name,
    content,
    owner: userId,
  };

  try {
    await pb.collection("templates").create(data);
    res.redirect("/templates?message=Template created successfully");
  } catch (error) {
    console.error("Failed to create template:", error);
    const pbErrors = error?.data?.data || {
      general: "Failed to create template.",
    };
    res.status(400).render("templates/new", {
      template: data,
      errors: pbErrors,
      pageTitle: "Create New Template",
    });
  }
});

router.get("/edit/:id", requireLogin, async (req, res, next) => {
  const templateId = req.params.id;
  const userId = req.session.user.id;

  try {
    const template = await getTemplateForEdit(templateId, userId);
    res.render("templates/edit", {
      template: template,
      errors: null,
      pageTitle: "Edit Template",
    });
  } catch (error) {
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    next(error);
  }
});

router.post("/edit/:id", requireLogin, async (req, res, next) => {
  const templateId = req.params.id;
  const userId = req.session.user.id;
  const { name, content } = req.body;
  const data = { name, content };

  try {
    await getTemplateForEdit(templateId, userId);
    await pb.collection("templates").update(templateId, data);
    res.redirect("/templates?message=Template updated successfully");
  } catch (error) {
    console.error(`Failed to update template ${templateId}:`, error);
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }

    const pbErrors = error?.data?.data || {
      general: "Failed to update template.",
    };

    const templateForRender = {
      id: templateId,
      ...data,
    };
    res.status(400).render("templates/edit", {
      template: templateForRender,
      errors: pbErrors,
      pageTitle: "Edit Template",
    });
  }
});

router.post("/delete/:id", requireLogin, async (req, res, next) => {
  const templateId = req.params.id;
  const userId = req.session.user.id;

  try {
    await getTemplateForEdit(templateId, userId);
    await pb.collection("templates").delete(templateId);
    res.redirect("/templates?message=Template deleted successfully");
  } catch (error) {
    console.error(`Failed to delete template ${templateId}:`, error);
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect("/templates?error=Error deleting template");
  }
});

export default router;
