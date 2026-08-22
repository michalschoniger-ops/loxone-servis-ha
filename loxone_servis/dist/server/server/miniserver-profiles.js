import { randomUUID } from "node:crypto";
import { transaction } from "./database.js";
function safeFields(value) {
    try {
        const parsed = JSON.parse(value ?? "[]");
        return Array.isArray(parsed)
            ? parsed.filter((item) => Boolean(item && typeof item === "object" && typeof item.key === "string"
                && typeof item.value === "string")).slice(0, 30)
            : [];
    }
    catch {
        return [];
    }
}
function tagsFor(db, serial) {
    return db.prepare(`SELECT t.id,t.name,t.color FROM tags t
     JOIN miniserver_tags mt ON mt.tag_id=t.id WHERE mt.serial=? ORDER BY t.name COLLATE NOCASE`).all(serial);
}
function emptyProfile(server, editable, inherited, source) {
    return {
        serial: server.serial, editable, inherited, sourceSerial: source.serial, sourceProject: source.project,
        customerName: "", contactName: "", contactRole: "", contactPhone: "", contactEmail: "",
        preferredChannel: "phone", siteAddress: "", siteType: "", serviceContract: "", slaHours: null,
        warrantyUntil: null, nextServiceAt: null, customFields: [], tags: [], updatedAt: null,
    };
}
export function getMiniserverProfile(db, serial) {
    const normalized = serial.toUpperCase();
    const server = db.prepare("SELECT serial,project,gateway_role,gateway_serial FROM miniservers WHERE serial=?")
        .get(normalized);
    if (!server)
        return null;
    const inherited = server.gateway_role === "client";
    const source = inherited && server.gateway_serial
        ? db.prepare("SELECT serial,project,gateway_role,gateway_serial FROM miniservers WHERE serial=?").get(server.gateway_serial)
        : server;
    const resolvedSource = source ?? server;
    const row = db.prepare("SELECT * FROM miniserver_profiles WHERE serial=?").get(resolvedSource.serial);
    if (!row)
        return emptyProfile(server, !inherited, inherited, resolvedSource);
    return {
        serial: server.serial,
        editable: !inherited,
        inherited,
        sourceSerial: resolvedSource.serial,
        sourceProject: resolvedSource.project,
        customerName: row.customer_name,
        contactName: row.contact_name,
        contactRole: row.contact_role,
        contactPhone: row.contact_phone,
        contactEmail: row.contact_email,
        preferredChannel: ["email", "sms", "whatsapp", "other"].includes(row.preferred_channel)
            ? row.preferred_channel : "phone",
        siteAddress: row.site_address,
        siteType: row.site_type,
        serviceContract: row.service_contract,
        slaHours: row.sla_hours === null ? null : Number(row.sla_hours),
        warrantyUntil: row.warranty_until,
        nextServiceAt: row.next_service_at,
        customFields: safeFields(row.custom_fields_json),
        tags: tagsFor(db, resolvedSource.serial),
        updatedAt: row.updated_at,
    };
}
export function saveMiniserverProfile(db, serial, input) {
    const normalized = serial.toUpperCase();
    const server = db.prepare("SELECT serial,project,gateway_role,gateway_serial FROM miniservers WHERE serial=?")
        .get(normalized);
    if (!server)
        throw Object.assign(new Error("Miniserver nebyl nalezen."), { code: "NOT_FOUND" });
    if (server.gateway_role === "client") {
        throw Object.assign(new Error("Client přebírá kontakt a servisní údaje z Gateway; vlastní údaje nelze uložit."), { code: "CLIENT_PROFILE_INHERITED" });
    }
    const now = new Date().toISOString();
    transaction(db, () => {
        db.prepare(`INSERT INTO miniserver_profiles(
        serial,customer_name,contact_name,contact_role,contact_phone,contact_email,preferred_channel,site_address,
        site_type,service_contract,sla_hours,warranty_until,next_service_at,custom_fields_json,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(serial) DO UPDATE SET
        customer_name=excluded.customer_name,contact_name=excluded.contact_name,contact_role=excluded.contact_role,
        contact_phone=excluded.contact_phone,contact_email=excluded.contact_email,preferred_channel=excluded.preferred_channel,
        site_address=excluded.site_address,site_type=excluded.site_type,service_contract=excluded.service_contract,
        sla_hours=excluded.sla_hours,warranty_until=excluded.warranty_until,next_service_at=excluded.next_service_at,
        custom_fields_json=excluded.custom_fields_json,updated_at=excluded.updated_at`).run(normalized, input.customerName, input.contactName, input.contactRole, input.contactPhone, input.contactEmail, input.preferredChannel, input.siteAddress, input.siteType, input.serviceContract, input.slaHours, input.warrantyUntil, input.nextServiceAt, JSON.stringify(input.customFields), now, now);
        db.prepare("DELETE FROM miniserver_tags WHERE serial=?").run(normalized);
        const insertTag = db.prepare(`INSERT INTO tags(id,name,color,created_at,updated_at) VALUES(?,?,?,?,?)
       ON CONFLICT(name) DO UPDATE SET color=excluded.color,updated_at=excluded.updated_at`);
        const findTag = db.prepare("SELECT id FROM tags WHERE name=? COLLATE NOCASE");
        const link = db.prepare("INSERT OR IGNORE INTO miniserver_tags(serial,tag_id) VALUES(?,?)");
        for (const tag of input.tags.slice(0, 20)) {
            const id = tag.id || randomUUID();
            insertTag.run(id, tag.name, tag.color, now, now);
            const stored = findTag.get(tag.name);
            link.run(normalized, stored.id);
        }
    });
    return getMiniserverProfile(db, normalized);
}
export function listTags(db) {
    return db.prepare("SELECT id,name,color FROM tags ORDER BY name COLLATE NOCASE").all();
}
