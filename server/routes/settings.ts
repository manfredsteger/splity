import { Router } from 'express';
import { isValidNamePattern, loadSettings, saveSettings } from '../config.js';

export const settingsRouter = Router();

// GET /api/settings
settingsRouter.get('/', (req, res) => {
  res.json(loadSettings());
});

// PUT /api/settings
settingsRouter.put('/', (req, res) => {
  const { defaultParts, namePattern, verifyAfterSplit } = req.body;

  if (defaultParts !== undefined) {
    const num = Number(defaultParts);
    if (!Number.isInteger(num) || num < 2 || num > 200) {
      return res.status(400).json({ error: 'Standard-Teilezahl muss eine ganze Zahl zwischen 2 und 200 sein.' });
    }
  }

  if (namePattern !== undefined) {
    if (typeof namePattern !== 'string' || !isValidNamePattern(namePattern)) {
      return res.status(400).json({
        error:
          'Ungültiges Namensmuster. Das Muster muss den Platzhalter {nr} enthalten und darf nur {name}, {nr}, {gesamt}, {start}, {ende} verwenden.',
      });
    }
  }

  const updated = saveSettings({
    defaultParts: defaultParts !== undefined ? Number(defaultParts) : undefined,
    namePattern: namePattern !== undefined ? String(namePattern).trim() : undefined,
    verifyAfterSplit: verifyAfterSplit !== undefined ? Boolean(verifyAfterSplit) : undefined,
  });

  res.json(updated);
});
