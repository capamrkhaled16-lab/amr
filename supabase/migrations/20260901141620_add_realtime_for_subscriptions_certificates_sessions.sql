-- Enable realtime for tables the parent portal listens to but that
-- are missing from the supabase_realtime publication.
ALTER PUBLICATION supabase_realtime ADD TABLE public.monthly_subscriptions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.certificates;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions;
