// Alert history store — reads and writes the alert history JSON file
// Also manages previous-state store for change detection

import { readJsonFile, writeJsonFile } from '../utils/file-store';
import type { Alert, AlertHistoryStore, PreviousStates, PortfolioState, OpportunityState } from '../types';

const ALERT_HISTORY_FILE = 'alert-history.json';
const PREVIOUS_STATES_FILE = 'previous-states.json';

// Simple ID generator without uuid dependency
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// --------------------------------------------------------------------------
// Alert history
// --------------------------------------------------------------------------

export function getAlertHistory(limit = 100): Alert[] {
  const all = readJsonFile<Alert[]>(ALERT_HISTORY_FILE, []);
  return all.slice(-limit).reverse(); // most recent first
}

export function saveAlert(alert: Alert): void {
  const existing = readJsonFile<Alert[]>(ALERT_HISTORY_FILE, []);
  existing.push(alert);
  // Keep last 500 alerts
  writeJsonFile(ALERT_HISTORY_FILE, existing.slice(-500));
}

export function saveAlerts(alerts: Alert[]): void {
  const existing = readJsonFile<Alert[]>(ALERT_HISTORY_FILE, []);
  const updated = [...existing, ...alerts].slice(-500);
  writeJsonFile(ALERT_HISTORY_FILE, updated);
}

// --------------------------------------------------------------------------
// Previous states store (for change detection)
// --------------------------------------------------------------------------

export function getPreviousStates(): PreviousStates {
  return readJsonFile<PreviousStates>(PREVIOUS_STATES_FILE, {
    updatedAt: '',
    portfolio: {},
    opportunities: {},
  });
}

export function savePreviousStates(states: PreviousStates): void {
  writeJsonFile(PREVIOUS_STATES_FILE, {
    ...states,
    updatedAt: new Date().toISOString(),
  });
}

// --------------------------------------------------------------------------
// Check if an alert should be sent (respects cooldown)
// --------------------------------------------------------------------------

export function shouldSendAlert(assetId: string, prev: PreviousStates): boolean {
  const cooldownHours = parseInt(process.env.ALERT_COOLDOWN_HOURS ?? '24', 10);
  const portfolio = prev.portfolio[assetId];
  const opp = prev.opportunities[assetId];
  const entry = portfolio ?? opp;

  if (!entry?.lastAlertAt) return true;

  const lastAlert = new Date(entry.lastAlertAt);
  const hoursSince = (Date.now() - lastAlert.getTime()) / (1000 * 60 * 60);
  return hoursSince >= cooldownHours;
}

// --------------------------------------------------------------------------
// Create a typed alert object
// --------------------------------------------------------------------------

export function createAlert(
  params: Omit<Alert, 'id' | 'timestamp' | 'telegramSent'> & { telegramSent?: boolean }
): Alert {
  return {
    ...params,
    id: genId(),
    timestamp: new Date().toISOString(),
    telegramSent: params.telegramSent ?? false,
  };
}
