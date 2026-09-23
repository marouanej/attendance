import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
} from "@simplewebauthn/server";
import { appConfig } from "./config";

export function createRegistrationOptions(employee, existingCredentials) {
  return generateRegistrationOptions({
    rpName: appConfig.rpName,
    rpID: appConfig.rpId,
    userName: employee.email,
    userDisplayName: `${employee.firstName} ${employee.lastName}`,
    userID: new TextEncoder().encode(employee.id),
    attestationType: "none",
    excludeCredentials: existingCredentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports,
    })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
}

export function createAuthenticationOptions(credentials) {
  return generateAuthenticationOptions({
    rpID: appConfig.rpId,
    userVerification: "required",
    allowCredentials: credentials.filter((credential) => !credential.revokedAt).map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports,
    })),
  });
}
