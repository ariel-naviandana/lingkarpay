export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string) =>
  new AppError("NOT_FOUND", `${what} tidak ditemukan`, 404);
export const conflict = (code: string, message: string) =>
  new AppError(code, message, 409);
export const forbidden = (message = "Tidak diizinkan") =>
  new AppError("FORBIDDEN", message, 403);
export const unauthorized = (message = "Perlu login") =>
  new AppError("UNAUTHORIZED", message, 401);
