import React, { createContext, useContext, useEffect, useState } from "react";

export type Residency = {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
};

type ResCtxType = {
  residency: Residency | null;
  setResidency: (residency: Residency) => void;
  clearResidency: () => void;
};

const ResCtx = createContext<ResCtxType | undefined>(undefined);

export const ResidencyProvider = ({ children }: { children: React.ReactNode }) => {
  const [residency, setResidencyState] = useState<Residency | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("selectedResidency");
    if (stored) {
      setResidencyState(JSON.parse(stored));
    }
  }, []);

  const setResidency = (res: Residency) => {
    sessionStorage.setItem("selectedResidency", JSON.stringify(res));
    setResidencyState(res);
  };

  const clearResidency = () => {
    sessionStorage.removeItem("selectedResidency");
    setResidencyState(null);
  };

  return (
    <ResCtx.Provider value={{ residency, setResidency, clearResidency }}>
      {children}
    </ResCtx.Provider>
  );
};

export const useResidency = () => {
  const ctx = useContext(ResCtx);
  if (!ctx) {
    throw new Error("useResidency must be used within ResidencyProvider");
  }
  return ctx;
};
