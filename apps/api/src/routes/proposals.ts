import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
import { castVote, createClosePeriodProposal, getProposalView, listProposals } from "../services/proposals.js";

const idParams = z.object({ id: z.coerce.number().int().positive() });
const periodParams = z.object({ periodId: z.coerce.number().int().positive() });
const voteBody = z.object({ approve: z.boolean() });

export async function proposalRoutes(app: FastifyInstance) {
  // Usulan menutup periode yang iurannya belum lengkap (keputusan operasional, perlu kuorum).
  app.post("/periods/:periodId/close-proposals", async (req, reply) => {
    const user = await requireUser(req);
    const { periodId } = periodParams.parse(req.params);
    const proposal = await createClosePeriodProposal(user, periodId);
    return reply.code(201).send(proposal);
  });

  app.get("/circles/:id/proposals", async (req) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    return { proposals: await listProposals(user, id) };
  });

  app.get("/proposals/:id", async (req) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    return getProposalView(user, id);
  });

  // Suara satu anggota (satu suara per usulan).
  app.post("/proposals/:id/votes", async (req, reply) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    const { approve } = voteBody.parse(req.body);
    const proposal = await castVote(user, id, approve);
    return reply.code(201).send(proposal);
  });
}
