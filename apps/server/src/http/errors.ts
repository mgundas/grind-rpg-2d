import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ApiErrorBody } from "@jadethrone/shared";
import { ServiceError } from "../errors";
import { logger } from "../logger";

function body(code: ApiErrorBody["error"]["code"], message: string): ApiErrorBody {
  return { error: { code, message } };
}

/**
 * Last middleware: domain errors (ServiceError) and JSON parse failures become
 * the shared `ApiErrorBody` shape. Unexpected errors are logged and never leak
 * SQL/messages to the client.
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ServiceError) {
    const payload: ApiErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
      },
    };
    res.status(error.status).json(payload);
    return;
  }

  const parseError = error as { type?: string; status?: number };
  if (parseError?.type === "entity.parse.failed") {
    res.status(400).json(body("validation", "Request body is not valid JSON."));
    return;
  }

  logger.error({ error }, "unhandled http error");
  res.status(500).json(body("internal", "Something went wrong. Try again."));
};

/** Mounted under `/api` so Colyseus's own routes are untouched. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(body("not_found", "Endpoint not found."));
};
