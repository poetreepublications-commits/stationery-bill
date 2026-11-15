-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ACCOUNTS', 'SALES', 'GODOWN', 'DEALER');

-- CreateEnum
CREATE TYPE "DealerType" AS ENUM ('SCHOOL', 'BOOKSELLER');

-- CreateEnum
CREATE TYPE "DealerStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "StockType" AS ENUM ('OPENING', 'RECEIPT', 'DISPATCH', 'RETURN', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PLACED', 'ACCEPTED', 'VERIFIED', 'SENT_TO_GODOWN', 'PICKING', 'PACKED', 'DISPATCHED', 'BILTY_UPLOADED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NoteType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'RECEIVED', 'APPROVED', 'CLOSED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "dealerId" INTEGER,
    "referralCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dealer" (
    "id" SERIAL NOT NULL,
    "firmName" TEXT NOT NULL,
    "type" "DealerType" NOT NULL DEFAULT 'SCHOOL',
    "ownerName" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "status" "DealerStatus" NOT NULL DEFAULT 'PENDING',
    "creditLimitPaise" INTEGER NOT NULL DEFAULT 0,
    "creditDays" INTEGER NOT NULL DEFAULT 30,
    "defaultDiscountBp" INTEGER NOT NULL DEFAULT 0,
    "openingBalancePaise" INTEGER NOT NULL DEFAULT 0,
    "returnLimitQty" INTEGER NOT NULL DEFAULT 0,
    "salesEmployeeId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Dealer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "School" (
    "id" SERIAL NOT NULL,
    "dealerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "board" TEXT,
    "contact" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Book" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "isbn" TEXT,
    "title" TEXT NOT NULL,
    "className" TEXT,
    "subject" TEXT,
    "series" TEXT,
    "board" TEXT,
    "mrpPaise" INTEGER NOT NULL,
    "hsn" TEXT,
    "weightGrams" INTEGER,
    "imagePath" TEXT,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookSet" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "className" TEXT,

    CONSTRAINT "BookSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookSetItem" (
    "id" SERIAL NOT NULL,
    "setId" INTEGER NOT NULL,
    "bookId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BookSetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockEntry" (
    "id" SERIAL NOT NULL,
    "bookId" INTEGER NOT NULL,
    "type" "StockType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" TEXT,
    "refType" TEXT,
    "refId" INTEGER,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermsVersion" (
    "id" SERIAL NOT NULL,
    "dealerId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "discountBp" INTEGER NOT NULL,
    "creditLimitPaise" INTEGER NOT NULL,
    "creditDays" INTEGER NOT NULL,
    "returnLimitQty" INTEGER NOT NULL,
    "paymentTerms" TEXT,
    "returnPolicy" TEXT,
    "clauses" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,

    CONSTRAINT "TermsVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermsAcceptance" (
    "id" SERIAL NOT NULL,
    "termsVersionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "ip" TEXT,
    "device" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermsAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "dealerId" INTEGER NOT NULL,
    "placedById" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PLACED',
    "discountBp" INTEGER NOT NULL DEFAULT 0,
    "discountNeedsApproval" BOOLEAN NOT NULL DEFAULT false,
    "discountApproved" BOOLEAN NOT NULL DEFAULT false,
    "creditOverride" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "schoolId" INTEGER NOT NULL,
    "bookId" INTEGER NOT NULL,
    "qtyOrdered" INTEGER NOT NULL,
    "qtyPicked" INTEGER NOT NULL DEFAULT 0,
    "qtyDispatched" INTEGER NOT NULL DEFAULT 0,
    "unitMrpPaise" INTEGER NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "userId" INTEGER,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "boxes" INTEGER,
    "weightKg" DOUBLE PRECISION,
    "transporter" TEXT,
    "vehicleNo" TEXT,
    "lrNo" TEXT,
    "eWayBill" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "biltyPath" TEXT,
    "biltyData" BYTEA,
    "biltyMime" TEXT,
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentLine" (
    "id" SERIAL NOT NULL,
    "shipmentId" INTEGER NOT NULL,
    "orderLineId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitMrpPaise" INTEGER NOT NULL,
    "discountBp" INTEGER NOT NULL,

    CONSTRAINT "ShipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "dealerId" INTEGER NOT NULL,
    "shipmentId" INTEGER NOT NULL,
    "fy" TEXT NOT NULL,
    "grossPaise" INTEGER NOT NULL,
    "discountPaise" INTEGER NOT NULL,
    "freightPaise" INTEGER NOT NULL DEFAULT 0,
    "roundOffPaise" INTEGER NOT NULL DEFAULT 0,
    "netPaise" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "type" "NoteType" NOT NULL,
    "dealerId" INTEGER NOT NULL,
    "returnId" INTEGER,
    "amountPaise" INTEGER NOT NULL,
    "reason" TEXT,
    "fy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "dealerId" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "reference" TEXT,
    "paidOn" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" SERIAL NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "dealerId" INTEGER NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT,
    "overLimit" BOOLEAN NOT NULL DEFAULT false,
    "overrideBy" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequestSchool" (
    "id" SERIAL NOT NULL,
    "returnId" INTEGER NOT NULL,
    "schoolId" INTEGER NOT NULL,

    CONSTRAINT "ReturnRequestSchool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnLine" (
    "id" SERIAL NOT NULL,
    "returnId" INTEGER NOT NULL,
    "bookId" INTEGER NOT NULL,
    "qtyRequested" INTEGER NOT NULL,
    "qtyReceived" INTEGER,
    "qtyApproved" INTEGER,
    "unitMrpPaise" INTEGER NOT NULL,
    "discountBp" INTEGER NOT NULL DEFAULT 0,
    "remark" TEXT,

    CONSTRAINT "ReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Target" (
    "id" SERIAL NOT NULL,
    "salesId" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_dealerId_key" ON "User"("dealerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Book_code_key" ON "Book"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Book_isbn_key" ON "Book"("isbn");

-- CreateIndex
CREATE UNIQUE INDEX "BookSet_name_key" ON "BookSet"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BookSetItem_setId_bookId_key" ON "BookSetItem"("setId", "bookId");

-- CreateIndex
CREATE UNIQUE INDEX "TermsVersion_dealerId_version_key" ON "TermsVersion"("dealerId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_number_key" ON "Shipment"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_shipmentId_key" ON "Invoice"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Note_number_key" ON "Note"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Note_returnId_key" ON "Note"("returnId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_number_key" ON "ReturnRequest"("number");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequestSchool_returnId_schoolId_key" ON "ReturnRequestSchool"("returnId", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Target_salesId_period_kind_key" ON "Target"("salesId", "period", "kind");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dealer" ADD CONSTRAINT "Dealer_salesEmployeeId_fkey" FOREIGN KEY ("salesEmployeeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "School" ADD CONSTRAINT "School_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookSetItem" ADD CONSTRAINT "BookSetItem_setId_fkey" FOREIGN KEY ("setId") REFERENCES "BookSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookSetItem" ADD CONSTRAINT "BookSetItem_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermsVersion" ADD CONSTRAINT "TermsVersion_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermsAcceptance" ADD CONSTRAINT "TermsAcceptance_termsVersionId_fkey" FOREIGN KEY ("termsVersionId") REFERENCES "TermsVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermsAcceptance" ADD CONSTRAINT "TermsAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequestSchool" ADD CONSTRAINT "ReturnRequestSchool_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ReturnRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequestSchool" ADD CONSTRAINT "ReturnRequestSchool_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ReturnRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_salesId_fkey" FOREIGN KEY ("salesId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- First owner (Super Admin) login. Change this password after first login.
INSERT INTO "User" (name, email, "passwordHash", role, active, "createdAt") VALUES ('Owner', 'admin@poetree.demo', '$2b$10$xnuDspFXBm0QjwVLYwGMseEZXuYWrnO9TJJTfK3FBG94kCA5cCnjO', 'SUPER_ADMIN', true, now());
