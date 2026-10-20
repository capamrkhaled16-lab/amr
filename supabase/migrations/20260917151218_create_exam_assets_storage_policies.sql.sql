-- Storage policies for exam-assets bucket
-- Allow authenticated users to upload, read, and delete their own exam assets

-- Files are stored under exam-lab/<exam_id>/ paths
-- We allow authenticated users to manage files in this bucket

DROP POLICY IF EXISTS "exam_assets_read" ON storage.objects;
CREATE POLICY "exam_assets_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'exam-assets');

DROP POLICY IF EXISTS "exam_assets_upload" ON storage.objects;
CREATE POLICY "exam_assets_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'exam-assets');

DROP POLICY IF EXISTS "exam_assets_update" ON storage.objects;
CREATE POLICY "exam_assets_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'exam-assets')
  WITH CHECK (bucket_id = 'exam-assets');

DROP POLICY IF EXISTS "exam_assets_delete" ON storage.objects;
CREATE POLICY "exam_assets_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'exam-assets');
