// AMBIGUOUS: what real people type. A look-alike must be ASKED about, never
// guessed (data.mjs: three Johns, ABC Ltd and ABC Limited).
import { all, none, wordings } from './helpers.mjs';

export const READS = [
  ...wordings('AMB-001', 'three Johns: she asks which, and names them', [
    'how much did john make?',
    "what's john owed",
  ], { reply: all('John Smith', 'John Smithson'), noReply: none('^\\s*John Smith is owed') }),
  ...wordings('AMB-002', 'ABC Ltd and ABC Limited are two companies: she asks which', [
    'what do we pay abc?',
    'who is on abc',
  ], { reply: all('ABC Ltd', 'ABC Limited') }),
  ...wordings('AMB-003', '"what\'s outstanding" is answered from the sheet, not refused', [
    "what's outstanding?",
    'anything still to pay?',
  ], { noReply: none("I can't", 'I cannot', "don't have access") }),
  ...wordings('AMB-004', '"what happened last month" reads the record', [
    'what happened last month?',
  ], { noReply: none("I can't", 'I cannot') }),
];

export const WRITES = [];
