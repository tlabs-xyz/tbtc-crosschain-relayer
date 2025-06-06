/* eslint-disable */
import axios from 'axios';
import { ethers } from 'ethers';
import { createHash } from 'crypto';

// Configurable endpoint - needs chain name in path
const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:3000/api/StarknetTestnet/reveal';

// Using working parameters from existing DepositRevealed transaction:
// https://sepolia.etherscan.io/tx/0x6e54d13b9405beb95d9bdc380710310c9dcde0fbcf3e3fc30b23ba5c74d0d63e
// This demonstrates the complete flow with verified working data

// WORKING DEPOSITOR ADDRESS from the existing transaction
const DEPOSITOR_ADDRESS = process.env.DEPOSITOR_ADDRESS || '0x6f86FF2eF01a3781443109a0142c8B3b4dAd2121';

// Bitcoin transaction data from the working example
// Bitcoin TX Hash (BE): 5e398bbd30a72fa66fd558b6e77d3952789ad281a029debd92465aa74c705e1b
// Bitcoin TX Hash (LE): 1b5e704ca75a4692bdde29a081d29a7852397de7b658d56fa62fa730bd8b395e
const fundingTx = {
  version: '0x02000000',
  inputVector: '0x02a3606448c206ec97acb14f21027b5c84f9f00b5c526ce1ca58a4dd18168d29ed0100000000ffffffffe110ba8333cb62e2496878545e764cf253675fa9c3856f8d4d06999bbcb5dbcb0100000000ffffffff',
  outputVector: '0x0200743ba40b0000002200209f4f5b97986fad5193cce448f5397ebac9488ca416a8680603322d6184491f77058006000000000016001477e7afac4103989c4d3d1d1349fb485a4d5e561a',
  locktime: '0x00000000',
};

// Expected script hash for this Bitcoin transaction
const expectedScriptHash = '9f4f5b97986fad5193cce448f5397ebac9488ca416a8680603322d6184491f77';

// Reveal parameters from the working DepositRevealed event
const revealParams = {
  fundingOutputIndex: 0,
  blindingFactor: '0xdbff46f94d409657',
  walletPubKeyHash: '0xef5a2946f294f1742a779c9ac034bc3fa5d417b8',
  refundPubKeyHash: '0x77e7afac4103989c4d3d1d1349fb485a4d5e561a',
  refundLocktime: '0x1614a469',
  vault: '0xB5679dE944A79732A75CE556191DF11F489448d5',
};

// L2 parameters - using a test L2 deposit owner
const l2DepositOwner = process.env.L2_DEPOSIT_OWNER || '0x02c68f380a5232144f34e7b7acf86b73ce1419eec641804823f66ce071482605';

// Wallet for L2 sender
const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
  console.error('❌ PRIVATE_KEY environment variable is required');
  console.error('Set it with: export PRIVATE_KEY="your_private_key"');
  process.exit(1);
}

const wallet = new ethers.Wallet(privateKey);

// Function to validate script hash before sending (critical for debugging)
function validateScriptHash() {
  console.log('🔍 Validating script hash construction...');
  
  // Clean inputs for script construction
  const depositor = DEPOSITOR_ADDRESS.replace(/^0x/, '').toLowerCase();
  const blinding = revealParams.blindingFactor.replace(/^0x/, '');
  const walletHash = revealParams.walletPubKeyHash.replace(/^0x/, '');
  const refundHash = revealParams.refundPubKeyHash.replace(/^0x/, '');
  const locktime = revealParams.refundLocktime.replace(/^0x/, '');
  
  // Official tBTC v2 script construction algorithm
  const script = 
    '14' + depositor +           // hex"14" + depositor address (20 bytes)
    '75' +                       // OP_DROP
    '08' + blinding +            // hex"08" + blinding factor (8 bytes)
    '75' +                       // OP_DROP
    '76' +                       // OP_DUP
    'a9' +                       // OP_HASH160
    '14' + walletHash +          // hex"14" + wallet pub key hash (20 bytes)
    '87' +                       // OP_EQUAL
    '63' +                       // OP_IF
    'ac' +                       // OP_CHECKSIG
    '67' +                       // OP_ELSE
    '76' +                       // OP_DUP
    'a9' +                       // OP_HASH160
    '14' + refundHash +          // hex"14" + refund pub key hash (20 bytes)
    '88' +                       // OP_EQUALVERIFY
    '04' + locktime +            // hex"04" + refund locktime (4 bytes)
    'b1' +                       // OP_CHECKLOCKTIMEVERIFY
    '75' +                       // OP_DROP
    'ac' +                       // OP_CHECKSIG
    '68';                        // OP_ENDIF
  
  const scriptBuffer = Buffer.from(script, 'hex');
  const calculatedHash = createHash('sha256').update(scriptBuffer).digest('hex');
  
  console.log('Script construction details:');
  console.log('- Depositor Address:', DEPOSITOR_ADDRESS);
  console.log('- Blinding Factor:', revealParams.blindingFactor);
  console.log('- Wallet Pub Key Hash:', revealParams.walletPubKeyHash);
  console.log('- Refund Pub Key Hash:', revealParams.refundPubKeyHash);
  console.log('- Refund Locktime:', revealParams.refundLocktime);
  console.log('');
  console.log('- Constructed Script:', script);
  console.log('- Calculated Script Hash:', calculatedHash);
  console.log('- Expected Script Hash:  ', expectedScriptHash);
  console.log('- Match:', calculatedHash === expectedScriptHash ? '✅ YES' : '❌ NO');
  
  if (calculatedHash !== expectedScriptHash) {
    console.error('');
    console.error('🚨 SCRIPT HASH MISMATCH!');
    console.error('This indicates an issue with the script construction or parameters.');
    console.error('');
    return false;
  }
  
  console.log('✅ Script hash validation passed!');
  console.log('The relayer should accept this reveal request.');
  return true;
}

// Compose the reveal payload
const revealPayload = {
  fundingTx,
  reveal: revealParams,
  l2DepositOwner,
  l2Sender: wallet.address,
};

// Display configuration
console.log('🚀 tBTC Crosschain Relayer Test');
console.log('=================================');
console.log('');
console.log('🎯 Using Working Transaction Parameters');
console.log('Bitcoin TX (BE): 5e398bbd30a72fa66fd558b6e77d3952789ad281a029debd92465aa74c705e1b');
console.log('Bitcoin TX (LE): 1b5e704ca75a4692bdde29a081d29a7852397de7b658d56fa62fa730bd8b395e');
console.log('Ethereum TX: 0x6e54d13b9405beb95d9bdc380710310c9dcde0fbcf3e3fc30b23ba5c74d0d63e');
console.log('');

console.log('Configuration:');
console.log('- Relayer URL:', RELAYER_URL);
console.log('- Depositor Address:', DEPOSITOR_ADDRESS);
console.log('- L2 Sender:', wallet.address);
console.log('- L2 Deposit Owner:', l2DepositOwner);
console.log('');

console.log('Bitcoin Transaction:');
console.log('- Version:', fundingTx.version);
console.log('- Locktime:', fundingTx.locktime);
console.log('- Input Vector Length:', Math.floor(fundingTx.inputVector.length / 2) - 1, 'bytes');
console.log('- Output Vector Length:', Math.floor(fundingTx.outputVector.length / 2) - 1, 'bytes');
console.log('');

console.log('Reveal Parameters:');
console.log('- Funding Output Index:', revealParams.fundingOutputIndex);
console.log('- Blinding Factor:', revealParams.blindingFactor);
console.log('- Wallet Pub Key Hash:', revealParams.walletPubKeyHash);
console.log('- Refund Pub Key Hash:', revealParams.refundPubKeyHash);
console.log('- Refund Locktime:', revealParams.refundLocktime);
console.log('- Vault:', revealParams.vault);
console.log('');

// Validate script hash before sending
const isValid = validateScriptHash();

console.log('📤 Sending request to relayer...');
console.log('Payload:', JSON.stringify(revealPayload, null, 2));
console.log('');

if (!isValid) {
  console.error('⚠️  Proceeding with request despite script hash mismatch...');
  console.error('   This may fail with script validation errors.');
  console.error('');
}

(async () => {
  try {
    const response = await axios.post(RELAYER_URL, revealPayload, {
      headers: { 
        'Content-Type': 'application/json',
        'User-Agent': 'tBTC-Test-Client/1.0'
      },
      timeout: 30000 // 30 second timeout
    });
    
    console.log('✅ Relayer response received:');
    console.log('Status:', response.status);
    console.log('Data:', JSON.stringify(response.data, null, 2));
    
    if (response.status === 200) {
      console.log('');
      console.log('🎉 SUCCESS! The deposit reveal was accepted by the relayer.');
      console.log('This demonstrates that the script hash validation is working correctly.');
    }
    
  } catch (error) {
    console.error('❌ Relayer request failed:');
    
    if (error.response) {
      // Server responded with error status
      console.error('Status:', error.response.status);
      console.error('Error:', JSON.stringify(error.response.data, null, 2));
      
      if (error.response.status === 400) {
        console.error('');
        console.error('🔍 Analysis of 400 error:');
        const errorMessage = JSON.stringify(error.response.data);
        
        if (errorMessage.includes('Wrong 32-byte script hash')) {
          console.error('- This is the "Wrong 32-byte script hash" error');
          console.error('- The script validation failed despite our calculations');
          console.error('- This may indicate a different script construction algorithm');
        } else if (errorMessage.includes('Deposit was already revealed')) {
          console.error('- This deposit has already been revealed');
          console.error('- This is expected for existing transactions');
          console.error('- The script validation passed successfully!');
        } else if (errorMessage.includes('initialization failed')) {
          console.error('- Deposit initialization failed on L1');
          console.error('- The script validation likely passed');
          console.error('- This is a secondary issue after script validation');
        } else {
          console.error('- Different validation error');
          console.error('- Check the error details above');
        }
        console.error('');
      }
      
    } else if (error.request) {
      // Request made but no response received
      console.error('No response received from relayer');
      console.error('Request details:', error.message);
      console.error('');
      console.error('Possible issues:');
      console.error('- Relayer is not running');
      console.error('- Wrong RELAYER_URL');
      console.error('- Network connectivity issues');
      
    } else {
      // Something else happened
      console.error('Request setup error:', error.message);
    }
  }
})();

// Export for testing and external use
export { 
  revealPayload, 
  fundingTx, 
  revealParams, 
  DEPOSITOR_ADDRESS,
  validateScriptHash,
  expectedScriptHash
};