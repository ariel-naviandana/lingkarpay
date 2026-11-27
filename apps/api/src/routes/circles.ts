import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
import {
  acceptInvitation,
  addMemberByEmail,
  cancelCircle,
  cancelInvitation,
  circlePayments,
  createCircle,
  declineInvitation,
  getCircleDetail,
  getPublicCircle,
  listCircles,
  listInvitations,
  listPeriods,
  removeDraftMember,
  startCircle,
} from "../services/circles.js";
import { PAYOUT_CHANNEL_CODES, setPayoutAccount } from "../services/payoutAccount.js";

const idParams = z.object({ id: z.coerce.number().int().positive() });
const inviteParams = idParams.extend({ memberId: z.coerce.number().int().positive() });

// Data dummy (sandbox). Nomor lengkap tidak disimpan, hanya 4 digit terakhir dan hash-nya.
const payoutAccountBody = z.object({
  channel: z.enum(PAYOUT_CHANNEL_CODES),
  accountNumber: z.string().trim().min(6).max(30),
  accountName: z.string().trim().min(2).max(100),
});

const createBody = z.object({
  name: z.string().trim().min(1).max(100),
  contributionAmount: z.number().int().min(1000),
  memberCount: z.number().int().min(2).max(50),
  periodDays: z.number().int().min(1).max(365),
  penaltyPct: z.number().int().min(0).max(100).default(0),
  // Tanggal mulai rencana (WIB). Kelompok baru bisa dikunci pada/sesudah tanggal ini.
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "format YYYY-MM-DD"),
  // Biaya admin TIDAK diterima dari klien: ditetapkan aplikasi (DEFAULT_ADMIN_FEE).
  // Pembuat juga anggota yang mendapat giliran, jadi rekening pencairannya wajib.
  payoutAccount: payoutAccountBody,
});
const addMemberBody = z.object({ email: z.string().trim().email() });
const acceptBody = z.object({ payoutAccount: payoutAccountBody });

export async function circleRoutes(app: FastifyInstance) {
  app.post("/circles", async (req, reply) => {
    const user = await requireUser(req);
    const circle = await createCircle(user.id, createBody.parse(req.body));
    return reply.code(201).send(circle);
  });

  app.get("/circles", async (req) => {
    const user = await requireUser(req);
    return { circles: await listCircles(user.id) };
  });

  app.get("/circles/:id", async (req) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    return getCircleDetail(user.id, id);
  });

  // Endpoint publik tanpa login untuk portal verifikasi
  app.get("/public/circles/:id", async (req) => {
    const { id } = idParams.parse(req.params);
    return getPublicCircle(id);
  });

  // Undangan: daftar undangan saya, terima (wajib isi rekening), tolak, dan pembatalan oleh pembuat.
  app.get("/invitations", async (req) => {
    const user = await requireUser(req);
    return { invitations: await listInvitations(user.id) };
  });

  app.post("/circles/:id/invitation/accept", async (req) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    const { payoutAccount } = acceptBody.parse(req.body);
    return acceptInvitation(user.id, id, payoutAccount);
  });

  app.post("/circles/:id/invitation/decline", async (req) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    return declineInvitation(user.id, id);
  });

  app.delete("/circles/:id/invitations/:memberId", async (req) => {
    const user = await requireUser(req);
    const { id, memberId } = inviteParams.parse(req.params);
    return cancelInvitation(user.id, id, memberId);
  });

  // Pembuat mengeluarkan anggota kelompok draft yang belum menyetor jaminan.
  app.delete("/circles/:id/members/:memberId", async (req) => {
    const user = await requireUser(req);
    const { id, memberId } = inviteParams.parse(req.params);
    return removeDraftMember(user.id, id, memberId);
  });

  // Pembuat membatalkan kelompok draft; jaminan yang sudah disetor dikembalikan.
  app.post("/circles/:id/cancel", async (req) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    return cancelCircle(user.id, id);
  });

  app.post("/circles/:id/members", async (req, reply) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    const { email } = addMemberBody.parse(req.body);
    return reply.code(201).send(await addMemberByEmail(user.id, id, email));
  });

  app.post("/circles/:id/start", async (req) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    // Urutan giliran diundi server; urutan kiriman klien tidak diterima.
    return startCircle(user.id, id);
  });

  app.get("/circles/:id/periods", async (req) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    return { periods: await listPeriods(user.id, id) };
  });

  // Anggota mengisi rekening pencairannya sendiri (tujuan transfer saat gilirannya cair).
  app.put("/circles/:id/payout-account", async (req) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    return { payoutAccount: await setPayoutAccount(user.id, id, payoutAccountBody.parse(req.body)) };
  });

  app.get("/circles/:id/payments", async (req) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    return circlePayments(user.id, id);
  });
}
