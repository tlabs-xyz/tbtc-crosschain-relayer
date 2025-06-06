import { z } from 'zod';
import { EthereumAddressSchema, HexStringSchema } from './shared';

// Define a general hex string schema, adjust length/pattern as needed for blindingFactor
const NumericStringSchema = z.string().regex(/^[0-9]+$/, 'Invalid numeric string');

export const RevealSchema = z.object({
  fundingOutputIndex: z.number().int().min(0),
  blindingFactor: HexStringSchema, // Example: Bytes32 would be .regex(/^0x[a-fA-F0-9]{64}$/)
  walletPubKeyHash: EthereumAddressSchema,
  refundPubKeyHash: EthereumAddressSchema,
  refundLocktime: NumericStringSchema, // Example: Could also be z.number().int().positive() if not a string
  vault: EthereumAddressSchema,
});

export type RevealRequestBody = z.infer<typeof RevealSchema>;

// Schema for FundingTransaction
export const FundingTransactionSchema = z.object({
  version: z.string(),
  inputVector: z.string(),
  outputVector: z.string(),
  locktime: z.string(),
});

// Schema for the entire /reveal endpoint request body
export const RevealEndpointBodySchema = z.object({
  fundingTx: FundingTransactionSchema, // Use the new specific schema
  reveal: RevealSchema,
  l2DepositOwner: EthereumAddressSchema,
  l2Sender: EthereumAddressSchema,
});

export type RevealEndpointBody = z.infer<typeof RevealEndpointBodySchema>;
