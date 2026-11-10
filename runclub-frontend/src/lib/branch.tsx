import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AdminBranch, Branch, ClubEvent } from "./types";
import { useAuth } from "./auth";

interface BranchContextValue {
  /** The branch active for runners and public pages: strictly "MADURAI" | "CHENNAI". */
  branch: Branch;
  setBranch: (branch: Branch) => void;
  /** Admin-level branch filter: "ALL" | "MADURAI" | "CHENNAI". Only used in admin dashboard. */
  adminBranch: AdminBranch;
  setAdminBranch: (adminBranch: AdminBranch) => void;
  /** Controls the interactive post-login / first-visit Chapter selection gateway screen. */
  showGateway: boolean;
  setShowGateway: (show: boolean) => void;
  /** Whether the user has explicitly selected their chapter in this browser. */
  hasChosenBranch: boolean;
}

const BranchContext = createContext<BranchContextValue | null>(null);

const STORAGE_KEY = "b2_selected_branch";
const CHOSEN_KEY = "b2_branch_chosen";
const ADMIN_STORAGE_KEY = "b2_admin_branch";

export function BranchProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const [branch, setBranchState] = useState<Branch>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Branch | null;
    if (saved === "CHENNAI" || saved === "MADURAI") return saved;
    return "MADURAI";
  });

  const [adminBranch, setAdminBranchState] = useState<AdminBranch>(() => {
    const saved = localStorage.getItem(ADMIN_STORAGE_KEY) as AdminBranch | null;
    if (saved === "ALL" || saved === "CHENNAI" || saved === "MADURAI") return saved;
    return "ALL";
  });

  const [hasChosenBranch, setHasChosenBranch] = useState<boolean>(() => {
    return localStorage.getItem(CHOSEN_KEY) === "true";
  });

  const [showGateway, setShowGateway] = useState<boolean>(() => {
    // If not chosen yet in this browser, show the gateway
    return localStorage.getItem(CHOSEN_KEY) !== "true";
  });

  // If user logs in with a specific saved branch, sync it
  useEffect(() => {
    if (user?.branch && (user.branch === "MADURAI" || user.branch === "CHENNAI")) {
      setBranchState(user.branch);
      localStorage.setItem(STORAGE_KEY, user.branch);
      setHasChosenBranch(true);
      localStorage.setItem(CHOSEN_KEY, "true");
    }
  }, [user]);

  const setBranch = useCallback((next: Branch) => {
    setBranchState(next);
    localStorage.setItem(STORAGE_KEY, next);
    setHasChosenBranch(true);
    localStorage.setItem(CHOSEN_KEY, "true");
    setShowGateway(false);
  }, []);

  const setAdminBranch = useCallback((next: AdminBranch) => {
    setAdminBranchState(next);
    localStorage.setItem(ADMIN_STORAGE_KEY, next);
  }, []);

  return (
    <BranchContext.Provider
      value={{
        branch,
        setBranch,
        adminBranch,
        setAdminBranch,
        showGateway,
        setShowGateway,
        hasChosenBranch,
      }}
    >
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) {
    throw new Error("useBranch must be used within a BranchProvider");
  }
  return ctx;
}

/** Determines whether an event belongs to Madurai or Chennai. */
export function getEventBranch(
  event: Partial<Pick<ClubEvent, "branch" | "location">>,
): Branch {
  if (event.branch === "CHENNAI" || event.branch === "MADURAI") {
    return event.branch;
  }
  const loc = (event.location || "").toLowerCase();
  if (/chennai|marina|besant|omr|ecr|adyar/i.test(loc)) {
    return "CHENNAI";
  }
  return "MADURAI";
}

/** Checks if an event matches a selected branch (or matches "ALL" for admins). */
export function matchesBranch(
  event: Partial<Pick<ClubEvent, "branch" | "location">>,
  selected: Branch | AdminBranch,
): boolean {
  if (selected === "ALL") return true;
  return getEventBranch(event) === selected;
}
