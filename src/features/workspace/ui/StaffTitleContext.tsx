"use client";

import { createContext, useContext } from 'react';

export const StaffTitleContext = createContext<(title: string) => (() => void)>(() => () => {});
export const useStaffTitleRegistration = () => useContext(StaffTitleContext);
