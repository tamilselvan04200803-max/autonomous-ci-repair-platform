def apply_discount(price: float, pct: float) -> float:
    return round(price * (pct / 100.0), 2)
