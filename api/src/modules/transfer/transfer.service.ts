import { Injectable } from '@nestjs/common';
import type { EndpointName } from '@schroeder/bc-contract';
import type { Tx } from '../../db/client.js';
import { bcTransfer } from '../../db/schema.js';

type Target = (typeof bcTransfer.$inferInsert)['target'];

/** Back-references updated by the worker once the transfer is done. */
export interface TransferMeta {
  timeEntryIds?: string[];
  consumptionIds?: string[];
  approvalId?: string;
  /** Resolve `employeeNumber` from the user's BC mapping when the transfer runs (fixable by the Admin, then retry). */
  employeeOfUserId?: string;
  /** Build the signed workshop order PDF of this order when the transfer runs (body.fileContent, E-68). */
  workOrderPdfOf?: string;
}

/**
 * Payload stored in bc_transfer.payload. `create` posts `body` (with monteurAppId = transfer id);
 * `patch` resolves the BC record id at execution time from `ref` (e.g. the assignment's bc_allocation_id),
 * so a patch queued right after a create works once the create is done (same group, processed in order).
 */
export type TransferPayload =
  | { op: 'create'; endpoint: EndpointName; body: Record<string, unknown>; meta?: TransferMeta }
  | {
      op: 'patch';
      endpoint: EndpointName;
      ref: { table: 'assignment' | 'service_order'; id: string };
      body: Record<string, unknown>;
    }
  /** Deletes the BC record created by an earlier transfer (`ref.id` = that transfer's id, same group). */
  | { op: 'delete'; endpoint: EndpointName; ref: { table: 'bc_transfer'; id: string } };

export interface EnqueueInput {
  id?: string;
  locationId: string;
  bcCompanyId: string;
  target: Target;
  subjectType: string;
  subjectId: string;
  groupKey: string;
  payload: TransferPayload;
}

/** Transactional outbox towards BC (ENTSCHEIDUNGEN E-09): enqueued in the same transaction as the approval. */
@Injectable()
export class TransferService {
  async enqueue(tx: Tx, input: EnqueueInput): Promise<string> {
    const [row] = await tx
      .insert(bcTransfer)
      .values({ ...input, payload: input.payload as unknown as Record<string, unknown> })
      .returning({ id: bcTransfer.id });
    return row!.id;
  }
}
