const express = require('express');
const router = express.Router();
const authenticateSupabase = require('../middleware/supabase-auth');
const folderService = require('../services/folder.service');

// All routes require authentication
router.use(authenticateSupabase);

/**
 * GET /api/folders - List all folders for current user (hierarchical tree)
 */
router.get('/folders', async (req, res) => {
  try {
    const folders = await folderService.getUserFolders(req.user.id);
    res.json(folders);
  } catch (err) {
    req.log.error({ err }, 'Failed to fetch folders');
    res.status(500).json({ error: 'Failed to load folders' });
  }
});

/**
 * POST /api/folders - Create new folder
 */
router.post('/folders', async (req, res) => {
  try {
    const { name, parentId } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    if (name.length > 100) {
      return res.status(400).json({ error: 'Folder name must be 100 characters or less' });
    }

    const folder = await folderService.createFolder(req.user.id, name.trim(), parentId || null);
    res.status(201).json(folder);
  } catch (err) {
    if (err.message.includes('Maximum folder depth')) {
      return res.status(400).json({ error: err.message });
    }
    if (err.message.includes('already exists')) {
      return res.status(409).json({ error: err.message });
    }
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    req.log.error({ err }, 'Failed to create folder');
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

/**
 * PUT /api/folders/:id - Rename folder
 */
router.put('/folders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    if (name.length > 100) {
      return res.status(400).json({ error: 'Folder name must be 100 characters or less' });
    }

    const folder = await folderService.renameFolder(req.user.id, id, name.trim());
    res.json(folder);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('already exists')) {
      return res.status(409).json({ error: err.message });
    }
    req.log.error({ err, folderId: id }, 'Failed to rename folder');
    res.status(500).json({ error: 'Failed to rename folder' });
  }
});

/**
 * PUT /api/folders/:id/move - Move folder to new parent
 */
router.put('/folders/:id/move', async (req, res) => {
  try {
    const { id } = req.params;
    const { newParentId } = req.body;

    const folder = await folderService.moveFolder(req.user.id, id, newParentId || null);
    res.json(folder);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Circular') || err.message.includes('Maximum depth') || err.message.includes('itself')) {
      return res.status(400).json({ error: err.message });
    }
    if (err.message.includes('already exists')) {
      return res.status(409).json({ error: err.message });
    }
    req.log.error({ err, folderId: id }, 'Failed to move folder');
    res.status(500).json({ error: 'Failed to move folder' });
  }
});

/**
 * DELETE /api/folders/:id - Delete folder and unfile all templates
 */
router.delete('/folders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await folderService.deleteFolder(req.user.id, id);
    res.status(204).send();
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    req.log.error({ err, folderId: id }, 'Failed to delete folder');
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

/**
 * PUT /api/templates/:id/move - Move template to folder (or unfile)
 */
router.put('/templates/:id/move', async (req, res) => {
  try {
    const { id } = req.params;
    const { folderId } = req.body; // null to unfile

    const template = await folderService.moveTemplate(req.user.id, id, folderId || null);
    res.json(template);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    req.log.error({ err, templateId: id }, 'Failed to move template');
    res.status(500).json({ error: 'Failed to move template' });
  }
});

module.exports = router;
