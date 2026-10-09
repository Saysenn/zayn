// RELATIONAL: across people, companies and groups (data.mjs).
import { all, none, shows, wordings } from './helpers.mjs';

export const READS = [
  ...wordings('REL-001', 'Pinecrest is Baker Jones, Karin Vole, Mara Quill and John Smith', [
    'who works on pinecrest?',
    'who handles pinecrest',
    "who's on pinecrest",
  ], { rows: shows('Baker Jones', 'Karin Vole', 'Mara Quill', 'John Smith'), noReply: none('Otto Fenn') }),
  ...wordings('REL-002', 'BAKER people who are paid: Otto Fenn and Juno Park, not Kiran (mixed)', [
    'who in baker has been paid?',
    'which baker people are marked paid',
  ], { reply: all('Otto Fenn', 'Juno Park') }),
  ...wordings('REL-003', 'ABC Ltd is Rae Dunn only', [
    'who is on abc ltd?',
  ], { reply: all('Rae Dunn'), noReply: none('Cole Pratt') }),
  ...wordings('REL-004', 'Which companies have nobody marked paid: answered from the people, never invented', [
    'which companies have unpaid people on them?',
  ], { noReply: none("can't", 'cannot') }),
];

export const WRITES = [];
