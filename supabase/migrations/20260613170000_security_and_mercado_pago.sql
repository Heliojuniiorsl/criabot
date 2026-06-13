ALTER TABLE public.contents
  ADD COLUMN IF NOT EXISTS preview_url text;

UPDATE public.contents
SET preview_url = file_url, file_url = NULL
WHERE preview_url IS NULL AND file_url IS NOT NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_sent_at timestamptz;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS provider_preference_id text,
  ADD COLUMN IF NOT EXISTS raw_status text,
  ADD COLUMN IF NOT EXISTS amount numeric(10,2);

CREATE UNIQUE INDEX IF NOT EXISTS payments_order_id_unique
  ON public.payments(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_payment_id_unique
  ON public.payments(provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

CREATE TABLE IF NOT EXISTS public.telegram_updates (
  update_id bigint PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_updates ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.telegram_updates TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_mercado_pago_payment(
  p_order_id uuid,
  p_provider_payment_id text,
  p_provider_status text,
  p_paid_at timestamptz,
  p_amount numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_duration integer;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF round(v_order.amount, 2) <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'payment_amount_mismatch';
  END IF;

  INSERT INTO public.payments (
    order_id, provider, provider_payment_id, status, raw_status, paid_at, amount
  ) VALUES (
    p_order_id, 'mercado_pago', p_provider_payment_id, 'paid', p_provider_status,
    COALESCE(p_paid_at, now()), p_amount
  )
  ON CONFLICT (order_id) DO UPDATE SET
    provider = EXCLUDED.provider,
    provider_payment_id = EXCLUDED.provider_payment_id,
    status = 'paid',
    raw_status = EXCLUDED.raw_status,
    paid_at = EXCLUDED.paid_at,
    amount = EXCLUDED.amount;

  IF v_order.status = 'paid' THEN RETURN false; END IF;

  UPDATE public.orders
  SET status = 'paid', fulfilled_at = now()
  WHERE id = p_order_id;

  IF v_order.plan_id IS NOT NULL THEN
    SELECT duration_days INTO v_duration FROM public.plans WHERE id = v_order.plan_id;
    IF v_duration IS NULL THEN RAISE EXCEPTION 'plan_not_found'; END IF;

    SELECT GREATEST(now(), COALESCE(MAX(end_date), now()))
      INTO v_start
      FROM public.subscriptions
      WHERE user_id = v_order.user_id AND status = 'active';
    v_end := v_start + make_interval(days => v_duration);

    INSERT INTO public.subscriptions (user_id, plan_id, start_date, end_date, status)
    VALUES (v_order.user_id, v_order.plan_id, v_start, v_end, 'active');
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_order_delivery(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.orders
  SET delivery_claimed_at = now()
  WHERE id = p_order_id
    AND status = 'paid'
    AND delivery_sent_at IS NULL
    AND (delivery_claimed_at IS NULL OR delivery_claimed_at < now() - interval '15 minutes');
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_due_broadcasts()
RETURNS SETOF public.broadcasts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.broadcasts b
  SET locked_at = now()
  WHERE b.id IN (
    SELECT candidate.id
    FROM public.broadcasts candidate
    WHERE candidate.is_active
      AND (candidate.last_sent_at IS NULL OR candidate.last_sent_at <= now() - make_interval(hours => candidate.interval_hours))
      AND (candidate.locked_at IS NULL OR candidate.locked_at < now() - interval '15 minutes')
    FOR UPDATE SKIP LOCKED
  )
  RETURNING b.*;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_mercado_pago_payment(uuid, text, text, timestamptz, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_order_delivery(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_due_broadcasts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_mercado_pago_payment(uuid, text, text, timestamptz, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_order_delivery(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_broadcasts() TO service_role;
