// BASIC: one person, one fact, asked many ways. Exact figures (data.mjs).
import { shows, wordings } from './helpers.mjs';

export const READS = [
  ...wordings('BAS-001', 'Otto Fenn is owed GBP 1,500', [
    'how much is otto fenn owed this month',
    "what's otto fenn on a month?",
    'otto fenn money this month',
    'how much do we pay otto',
  ], { answer: { amount: 1500, currency: 'GBP' } }),
  ...wordings('BAS-002', 'Kiran Vale is owed GBP 5,350 (Brightwell less its 5% fee)', [
    'how much is kiran vale owed in pounds this month',
    "what's kiran getting in GBP",
  ], { answer: { amount: 5350, currency: 'GBP' } }),
  ...wordings('BAS-003', 'Kiran Vale is owed AED 6,000', [
    'how much is kiran vale owed in dirhams',
    "kiran's AED this month",
  ], { answer: { amount: 6000, currency: 'AED' } }),
  ...wordings('BAS-004', 'Ines Calder is owed AED 4,000', [
    'how much does ines calder get',
    "what's ines owed",
  ], { answer: { amount: 4000, currency: 'AED' } }),
  ...wordings('BAS-005', 'Kiran Vale holds three deals', [
    'what deals does kiran vale have',
    'show me kiran vale',
    'which companies is kiran on',
  ], { rows: shows('Brightwell', 'Ironleaf', 'Harbor Nine') }),
  ...wordings('BAS-006', 'Felix Orr is on 1,450 now', [
    "what's felix orr's monthly",
    'how much is felix owed this month',
  ], { answer: { amount: 1450, currency: 'GBP' } }),
];

export const WRITES = [];
