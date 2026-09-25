import { Router } from 'express';
import { loadSettings, saveSettings } from '../config.js';

export const settingsRouter = Router();

// GET /api/settings
settingsRouter.get('/', (req, res) => {
  res.json(loadSettings());
});

// PUT /api/settings
settingsRouter.put('/', (req, res) => {
  const { defaultParts, namePattern } = req.body;
  const updated = saveSettings({ defaultParts, namePattern });
  res.json(updated);
});
