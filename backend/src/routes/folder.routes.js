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
} = require('../schemas/folder.schemas');

// All routes require authentication — safe because this router is mounted at /api/folders
router.use(authenticateSupabase);

/**
 * GET /api/folders
 */
router.get('/', async (req, res) => {
  try {
    const folders = await folderService.getUserFolders(req.user.id);
    res.json(folders);
  } catch (err) {
    req.log.error({ err }, 'Failed to fetch folders');
    errorResponse.internal(res, 'Failed to load folders');
  }
});

/**
 * POST /api/folders
 */
router.post('/', validate({ body: createFolderBody }), async (req, res) => {
  try {
    const { name, parentId } = req.body;

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
 * PUT /api/folders/:id
 */
router.put('/:id', validate({ params: folderIdParams, body: renameFolderBody }), async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

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
 * PUT /api/folders/:id/move
 */
router.put('/:id/move', validate({ params: folderIdParams, body: moveFolderBody }), async (req, res) => {
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
 * DELETE /api/folders/:id
 */
router.delete('/:id', validate({ params: folderIdParams }), async (req, res) => {
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

module.exports = router;
