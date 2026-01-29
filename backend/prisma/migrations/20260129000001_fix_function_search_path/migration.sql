-- Fix security issue: Set explicit search_path on validate_folder_hierarchy function
-- This prevents search path injection attacks

CREATE OR REPLACE FUNCTION public.validate_folder_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  current_parent_id TEXT;
  depth_count INT := 1;
BEGIN
  -- If no parent, depth must be 1
  IF NEW."parentId" IS NULL THEN
    NEW.depth := 1;
    RETURN NEW;
  END IF;

  -- Traverse up the tree to check for cycles and calculate depth
  current_parent_id := NEW."parentId";

  WHILE current_parent_id IS NOT NULL LOOP
    -- Check if we've hit the folder being modified (cycle detection)
    IF current_parent_id = NEW.id THEN
      RAISE EXCEPTION 'Circular folder reference detected';
    END IF;

    depth_count := depth_count + 1;

    -- Check max depth
    IF depth_count > 4 THEN
      RAISE EXCEPTION 'Maximum folder depth of 4 exceeded';
    END IF;

    -- Move to next parent (use fully qualified table name)
    SELECT "parentId" INTO current_parent_id
    FROM public."Folder"
    WHERE id = current_parent_id;
  END LOOP;

  -- Set calculated depth
  NEW.depth := depth_count;
  RETURN NEW;
END;
$$;
