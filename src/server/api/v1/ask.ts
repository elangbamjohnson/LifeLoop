import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../../middlewares/auth";
import { requireAdmin } from "../../middlewares/admin";
import { askService } from "../../services/AskService";

export const askRouter = Router();

askRouter.post("/", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ error: "Question is required" });
    }

    const result = await askService.askQuestion(req.userId!, question);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
