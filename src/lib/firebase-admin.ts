import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(currentDir, '../../firebase-applet-config.json');
const rawConfig = fs.readFileSync(configPath, 'utf-8');
const firebaseConfig = JSON.parse(rawConfig) as FirebaseAppletConfig;

const adminApp = getApps().length
  ? getApps()[0]
  : initializeApp({
      projectId: firebaseConfig.projectId,
    });

// On Starter Tier projects without IAM privileges, Admin SDK is strictly limited
// to stateless ID token verification (`verifyIdToken`). All Firestore operations
// execute through the client Firebase SDK enforced by firestore.rules.
export const adminAuth = getAuth(adminApp);
export const firebaseProjectId = firebaseConfig.projectId;
export const firestoreDatabaseId = firebaseConfig.firestoreDatabaseId || '(default)';
