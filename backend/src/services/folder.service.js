const prisma = require('../config/prisma');

/**
 * Get all folders for a user as hierarchical tree
 */
async function getUserFolders(userId) {
  const folders = await prisma.folder.findMany({
    where: { userId },
    include: {
      _count: {
        select: {
          templates: { where: { isActive: true } },
          children: true,
        },
      },
    },
    orderBy: [{ depth: 'asc' }, { name: 'asc' }],
  });

  return folders;
}

/**
 * Create a new folder with depth validation
 */
async function createFolder(userId, name, parentId = null) {
  // Validate parent exists and belongs to user
  if (parentId) {
    const parent = await prisma.folder.findFirst({
      where: { id: parentId, userId },
    });

    if (!parent) {
      throw new Error('Parent folder not found');
    }

    // Check depth constraint
    if (parent.depth >= 4) {
      throw new Error('Maximum folder depth of 4 exceeded');
    }

    // Check for duplicate name in same parent
    const existing = await prisma.folder.findFirst({
      where: { userId, parentId, name },
    });

    if (existing) {
      throw new Error('A folder with this name already exists in the same location');
    }

    // Create with calculated depth
    return await prisma.folder.create({
      data: {
        name,
        parentId,
        depth: parent.depth + 1,
        userId,
      },
      include: {
        _count: {
          select: { templates: true, children: true },
        },
      },
    });
  }

  // Root folder - check for duplicate name at root level
  const existing = await prisma.folder.findFirst({
    where: { userId, parentId: null, name },
  });

  if (existing) {
    throw new Error('A root folder with this name already exists');
  }

  return await prisma.folder.create({
    data: {
      name,
      parentId: null,
      depth: 1,
      userId,
    },
    include: {
      _count: {
        select: { templates: true, children: true },
      },
    },
  });
}

/**
 * Rename a folder
 */
async function renameFolder(userId, folderId, newName) {
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, userId },
  });

  if (!folder) {
    throw new Error('Folder not found');
  }

  // Check for duplicate name in same parent
  const existing = await prisma.folder.findFirst({
    where: {
      userId,
      parentId: folder.parentId,
      name: newName,
      NOT: { id: folderId },
    },
  });

  if (existing) {
    throw new Error('A folder with this name already exists in the same location');
  }

  return await prisma.folder.update({
    where: { id: folderId },
    data: { name: newName },
    include: {
      _count: {
        select: { templates: true, children: true },
      },
    },
  });
}

/**
 * Move folder to new parent (with cycle detection and depth recalculation)
 */
async function moveFolder(userId, folderId, newParentId) {
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, userId },
    include: { children: true },
  });

  if (!folder) {
    throw new Error('Folder not found');
  }

  // Cannot move to itself
  if (folderId === newParentId) {
    throw new Error('Cannot move folder into itself');
  }

  // Validate new parent
  if (newParentId) {
    const newParent = await prisma.folder.findFirst({
      where: { id: newParentId, userId },
    });

    if (!newParent) {
      throw new Error('Target folder not found');
    }

    // Fetch all user folders once for in-memory traversal
    const allFolders = await fetchAllUserFolders(userId);

    // Check if newParent is a descendant of folder (cycle detection)
    if (checkIsDescendantInMemory(allFolders, folderId, newParentId)) {
      throw new Error('Circular reference: cannot move folder into its own subtree');
    }

    // Calculate new depth
    const newDepth = newParent.depth + 1;

    // Check if move would exceed max depth (considering deepest child)
    const maxChildDepth = getMaxChildDepthInMemory(allFolders, folderId);
    const childrenDepthOffset = maxChildDepth - folder.depth;

    if (newDepth + childrenDepthOffset > 4) {
      throw new Error('Moving this folder would exceed maximum depth of 4');
    }

    // Check for duplicate name
    const existing = await prisma.folder.findFirst({
      where: {
        userId,
        parentId: newParentId,
        name: folder.name,
        NOT: { id: folderId },
      },
    });

    if (existing) {
      throw new Error('A folder with this name already exists in the target location');
    }

    // Update folder and recalculate depths for entire subtree
    await recalculateSubtreeDepths(allFolders, folderId, newDepth);

    return await prisma.folder.update({
      where: { id: folderId },
      data: { parentId: newParentId, depth: newDepth },
      include: {
        _count: {
          select: { templates: true, children: true },
        },
      },
    });
  }

  // Move to root (newParentId is null)
  const existing = await prisma.folder.findFirst({
    where: {
      userId,
      parentId: null,
      name: folder.name,
      NOT: { id: folderId },
    },
  });

  if (existing) {
    throw new Error('A root folder with this name already exists');
  }

  // Fetch all user folders for in-memory traversal (if not already fetched)
  const allFoldersForRoot = await fetchAllUserFolders(userId);

  // Recalculate depths starting from 1
  await recalculateSubtreeDepths(allFoldersForRoot, folderId, 1);

  return await prisma.folder.update({
    where: { id: folderId },
    data: { parentId: null, depth: 1 },
    include: {
      _count: {
        select: { templates: true, children: true },
      },
    },
  });
}

/**
 * Delete folder and cascade to children, unfile all templates in subtree
 */
async function deleteFolder(userId, folderId) {
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, userId },
  });

  if (!folder) {
    throw new Error('Folder not found');
  }

  // Fetch all user folders and get subtree IDs in memory
  const allFoldersForDelete = await fetchAllUserFolders(userId);
  const subtreeFolderIds = getSubtreeFolderIdsInMemory(allFoldersForDelete, folderId);

  // Unfile all templates in subtree (set folderId to null)
  await prisma.template.updateMany({
    where: { folderId: { in: subtreeFolderIds } },
    data: { folderId: null },
  });

  // Delete folder (cascade will handle children)
  await prisma.folder.delete({
    where: { id: folderId },
  });
}

/**
 * Move template to folder or unfile
 */
async function moveTemplate(userId, templateId, folderId) {
  // Verify template exists
  const template = await prisma.template.findUnique({
    where: { id: templateId },
  });

  if (!template) {
    throw new Error('Template not found');
  }

  if (template.uploadedById !== userId) {
    throw new Error('Template not found');
  }

  // Verify folder exists and belongs to user (if folderId provided)
  if (folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: folderId, userId },
    });

    if (!folder) {
      throw new Error('Folder not found');
    }
  }

  return await prisma.template.update({
    where: { id: templateId },
    data: { folderId },
    include: { fields: true, folder: true },
  });
}

// Helper functions
// All tree traversal is done in memory after a single bulk fetch,
// avoiding N+1 DB queries. Max depth is 4, so trees are small.

/**
 * Fetch all folders for a user in one query
 */
async function fetchAllUserFolders(userId) {
  return prisma.folder.findMany({
    where: { userId },
    select: { id: true, parentId: true, depth: true },
  });
}

/**
 * Check if descendantId is a descendant of ancestorId (in-memory)
 */
function checkIsDescendantInMemory(folders, ancestorId, descendantId) {
  const folderMap = new Map(folders.map((f) => [f.id, f]));
  let currentId = descendantId;

  while (currentId) {
    if (currentId === ancestorId) return true;
    currentId = folderMap.get(currentId)?.parentId || null;
  }

  return false;
}

/**
 * Get maximum depth in folder's subtree (in-memory)
 */
function getMaxChildDepthInMemory(folders, folderId) {
  const childrenMap = new Map();
  for (const f of folders) {
    const pid = f.parentId || '__root__';
    if (!childrenMap.has(pid)) childrenMap.set(pid, []);
    childrenMap.get(pid).push(f);
  }

  const traverse = (id) => {
    const folder = folders.find((f) => f.id === id);
    const children = childrenMap.get(id) || [];
    if (children.length === 0) return folder?.depth || 1;
    return Math.max(...children.map((c) => traverse(c.id)));
  };

  return traverse(folderId);
}

/**
 * Get all folder IDs in subtree, including the folder itself (in-memory)
 */
function getSubtreeFolderIdsInMemory(folders, folderId) {
  const childrenMap = new Map();
  for (const f of folders) {
    const pid = f.parentId || '__root__';
    if (!childrenMap.has(pid)) childrenMap.set(pid, []);
    childrenMap.get(pid).push(f);
  }

  const result = [];
  const traverse = (id) => {
    result.push(id);
    for (const child of childrenMap.get(id) || []) {
      traverse(child.id);
    }
  };
  traverse(folderId);
  return result;
}

/**
 * Recalculate depths for folder and all descendants (batch update)
 */
async function recalculateSubtreeDepths(folders, folderId, newDepth) {
  const childrenMap = new Map();
  for (const f of folders) {
    const pid = f.parentId || '__root__';
    if (!childrenMap.has(pid)) childrenMap.set(pid, []);
    childrenMap.get(pid).push(f);
  }

  // Collect all updates
  const updates = [];
  const traverse = (id, depth) => {
    updates.push({ id, depth });
    for (const child of childrenMap.get(id) || []) {
      traverse(child.id, depth + 1);
    }
  };
  traverse(folderId, newDepth);

  // Batch update all folders
  await Promise.all(
    updates.map(({ id, depth }) =>
      prisma.folder.update({ where: { id }, data: { depth } })
    )
  );
}

module.exports = {
  getUserFolders,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  moveTemplate,
};
