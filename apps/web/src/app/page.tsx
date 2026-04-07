"use client";

import { CreateTripDialog } from "@/components/create-trip-dialog";
import { TripList } from "@/components/trip-list";
import { Plane } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Plane className="h-7 w-7" />
            <h1 className="text-2xl font-bold">My Trips</h1>
          </div>
          <CreateTripDialog />
        </div>
        <TripList />
      </div>
    </main>
  );
}
