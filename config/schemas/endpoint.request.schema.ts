import { z } from 'zod';

const hexString = (length: number) =>
  z.string().regex(new RegExp(`^0x[0-9a-fA-F]{${length}}$`), {
    message: `Must be a valid hex string with a 0x prefix and ${length} characters`,
  });

// TODO: Add request validation to other endpoints
export const RevealRequestSchema = z.object({
  fundingTx: z.object({
    version: z.string(),
    inputVector: z.string(),
    outputVector: z.string(),
    locktime: z.string(),
  }),
  reveal: z.object({
    fundingOutputIndex: z.number().int().nonnegative(),
    blindingFactor: hexString(16),
    walletPubKeyHash: hexString(40),
    refundPubKeyHash: hexString(40),
    refundLocktime: hexString(8),
    vault: hexString(40),
  }),
  l2DepositOwner: z.string(),
  l2Sender: z.string(),
});
