import PolicyEnv.Basic

-- POS-001: Block any single-asset position that would exceed 25% of total portfolio value.

namespace PolicyEnv

/-- POS-001 maximum single-asset position: 25% = 2500 basis points -/
def pos001LimitBps : Nat := 2500

/--
  POS-001 compliance predicate.
  newWeightBps is the proposed position weight in basis points (e.g. 2200 = 22%).
  Returns true when newWeightBps ≤ 2500 (i.e., ≤ 25%).
-/
def pos001Compliant (newWeightBps : Nat) : Bool :=
  positionWithinLimit newWeightBps pos001LimitBps

end PolicyEnv
