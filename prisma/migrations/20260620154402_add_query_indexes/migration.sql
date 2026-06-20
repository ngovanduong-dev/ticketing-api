-- CreateIndex
CREATE INDEX "bookings_userId_createdAt_idx" ON "bookings"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "bookings_eventId_status_idx" ON "bookings"("eventId", "status");

-- CreateIndex
CREATE INDEX "events_status_date_idx" ON "events"("status", "date");

-- CreateIndex
CREATE INDEX "events_categoryId_status_date_idx" ON "events"("categoryId", "status", "date");

-- CreateIndex
CREATE INDEX "events_organizerId_idx" ON "events"("organizerId");
