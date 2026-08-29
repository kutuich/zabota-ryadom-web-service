import { Module } from "@nestjs/common";
import { StaticDeliveryController } from "./static-delivery.controller";

@Module({ controllers: [StaticDeliveryController] })
export class StaticDeliveryModule {}
