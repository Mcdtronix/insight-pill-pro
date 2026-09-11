import { config } from "@/lib/config";
import { mockApi } from "@/mock/mockApi";
import type { Forecast } from "@/types/domain";
import { request } from "./client";

export const forecastApi = {
  forMedicine: (medicineId: string, horizonDays: number): Promise<Forecast> =>
    config.useMock
      ? mockApi.forecast(medicineId, horizonDays)
      : request<Forecast>(`/medicines/${medicineId}/forecast/`, { params: { horizon: horizonDays } }),
};
