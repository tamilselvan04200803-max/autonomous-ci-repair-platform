from pkg.m1 import f1
from pkg.m2 import f2
from pkg.m3 import f3
from pkg.m4 import f4

def test_all() -> None:
    assert (f1(1), f2(2), f3(3), f4(4)) == (2, 4, 6, 8)
