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

    // Check if newParent is a descendant of folder (cycle detection)
    const isDescendant = await checkIsDescendant(folderId, newParentId);
    if (isDescendant) {
      throw new Error('Circular reference: cannot move folder into its own subtree');
    }

    // Calculate new depth
    const newDepth = newParent.depth + 1;

    // Check if move would exceed max depth (considering deepest child)
    const maxChildDepth = await getMaxChildDepth(folderId);
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
    await recalculateSubtreeDepths(folderId, newDepth);

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

  // Recalculate depths starting from 1
  await recalculateSubtreeDepths(folderId, 1);

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

  // Get all folder IDs in subtree
  const subtreeFolderIds = await getSubtreeFolderIds(folderId);

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

/**
 * Check if descendantId is a descendant of ancestorId
 */
async function checkIsDescendant(ancestorId, descendantId) {
  let currentId = descendantId;

  while (currentId) {
    if (currentId === ancestorId) {
      return true;
    }

    const folder = await prisma.folder.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });

    currentId = folder?.parentId;
  }

  return false;
}

/**
 * Get maximum depth in folder's subtree
 */
async function getMaxChildDepth(folderId) {
  const folders = await prisma.folder.findMany({
    where: {
      OR: [
        { id: folderId },
        // Get all descendants recursively using a raw query would be more efficient
        // but for now, we'll fetch all and traverse in memory
      ],
    },
  });

  // For simplicity, we'll traverse the tree recursively
  // In production, consider using a recursive CTE query
  const getDepthRecursive = async (id) => {
    const folder = await prisma.folder.findUnique({
      where: { id },
      select: { depth: true },
    });

    const children = await prisma.folder.findMany({
      where: { parentId: id },
      select: { id: true },
    });

    if (children.length === 0) {
      return folder?.depth || 1;
    }

    const childDepths = await Promise.all(
      children.map((child) => getDepthRecursive(child.id))
    );

    return Math.max(...childDepths);
  };

  return await getDepthRecursive(folderId);
}

/**
 * Get all folder IDs in subtree (including the folder itself)
 */
async function getSubtreeFolderIds(folderId, acc = []) {
  acc.push(folderId);

  const children = await prisma.folder.findMany({
    where: { parentId: folderId },
    select: { id: true },
  });

  for (const child of children) {
    await getSubtreeFolderIds(child.id, acc);
  }

  return acc;
}

/**
 * Recursively update depths for folder and all descendants
 */
async function recalculateSubtreeDepths(folderId, newDepth) {
  // Update current folder
  await prisma.folder.update({
    where: { id: folderId },
    data: { depth: newDepth },
  });

  // Update all children recursively
  const children = await prisma.folder.findMany({
    where: { parentId: folderId },
    select: { id: true },
  });

  for (const child of children) {
    await recalculateSubtreeDepths(child.id, newDepth + 1);
  }
}

module.exports = {
  getUserFolders,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  moveTemplate,
};
