const express = require('express');
const router = express.Router();
const authenticateSupabase = require('../middleware/supabase-auth');
const { validate } = require('../middleware/validate');
const folderService = require('../services/folder.service');
const { errorResponse, ErrorCodes } = require('../utils/errorResponse');
const {
  folderIdParams,
  createFolderBody,
  renameFolderBody,
  moveFolderBody,
  moveTemplateParams,
  moveTemplateBody,
} = require('../schemas/folder.schemas');

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
    errorResponse.internal(res, 'Failed to load folders');
  }
});

/**
 * POST /api/folders - Create new folder
 */
router.post('/folders', validate({ body: createFolderBody }), async (req, res) => {
  try {
    const { name, parentId } = req.body; // Already validated and trimmed by Zod

    const folder = await folderService.createFolder(req.user.id, name, parentId || null);
    res.status(201).json(folder);
  } catch (err) {
    if (err.message.includes('Maximum folder depth')) {
      return errorResponse.badRequest(res, err.message, ErrorCodes.VALIDATION_ERROR);
    }
    if (err.message.includes('already exists')) {
      return errorResponse.conflict(res, err.message, ErrorCodes.ALREADY_EXISTS);
    }
    if (err.message.includes('not found')) {
      return errorResponse.notFound(res, err.message, ErrorCodes.FOLDER_NOT_FOUND);
    }
    req.log.error({ err }, 'Failed to create folder');
    errorResponse.internal(res, 'Failed to create folder');
  }
});

/**
 * PUT /api/folders/:id - Rename folder
 */
router.put('/folders/:id', validate({ params: folderIdParams, body: renameFolderBody }), async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body; // Already validated and trimmed by Zod

    const folder = await folderService.renameFolder(req.user.id, id, name);
    res.json(folder);
  } catch (err) {
    if (err.message.includes('not found')) {
      return errorResponse.notFound(res, err.message, ErrorCodes.FOLDER_NOT_FOUND);
    }
    if (err.message.includes('already exists')) {
      return errorResponse.conflict(res, err.message, ErrorCodes.ALREADY_EXISTS);
    }
    req.log.error({ err, folderId: req.params.id }, 'Failed to rename folder');
    errorResponse.internal(res, 'Failed to rename folder');
  }
});

/**
 * PUT /api/folders/:id/move - Move folder to new parent
 */
router.put('/folders/:id/move', validate({ params: folderIdParams, body: moveFolderBody }), async (req, res) => {
  try {
    const { id } = req.params;
    const { newParentId } = req.body;

    const folder = await folderService.moveFolder(req.user.id, id, newParentId || null);
    res.json(folder);
  } catch (err) {
    if (err.message.includes('not found')) {
      return errorResponse.notFound(res, err.message, ErrorCodes.FOLDER_NOT_FOUND);
    }
    if (err.message.includes('Circular') || err.message.includes('Maximum depth') || err.message.includes('itself')) {
      return errorResponse.badRequest(res, err.message, ErrorCodes.VALIDATION_ERROR);
    }
    if (err.message.includes('already exists')) {
      return errorResponse.conflict(res, err.message, ErrorCodes.ALREADY_EXISTS);
    }
    req.log.error({ err, folderId: req.params.id }, 'Failed to move folder');
    errorResponse.internal(res, 'Failed to move folder');
  }
});

/**
 * DELETE /api/folders/:id - Delete folder and unfile all templates
 */
router.delete('/folders/:id', validate({ params: folderIdParams }), async (req, res) => {
  try {
    const { id } = req.params;
    await folderService.deleteFolder(req.user.id, id);
    res.status(204).send();
  } catch (err) {
    if (err.message.includes('not found')) {
      return errorResponse.notFound(res, err.message, ErrorCodes.FOLDER_NOT_FOUND);
    }
    req.log.error({ err, folderId: req.params.id }, 'Failed to delete folder');
    errorResponse.internal(res, 'Failed to delete folder');
  }
});

/**
 * PUT /api/templates/:id/move - Move template to folder (or unfile)
 */
router.put('/templates/:id/move', validate({ params: moveTemplateParams, body: moveTemplateBody }), async (req, res) => {
  try {
    const { id } = req.params;
    const { folderId } = req.body; // null to unfile

    const template = await folderService.moveTemplate(req.user.id, id, folderId || null);
    res.json(template);
  } catch (err) {
    if (err.message.includes('not found')) {
      return errorResponse.notFound(res, err.message, ErrorCodes.NOT_FOUND);
    }
    req.log.error({ err, templateId: req.params.id }, 'Failed to move template');
    errorResponse.internal(res, 'Failed to move template');
  }
});

module.exports = router;
