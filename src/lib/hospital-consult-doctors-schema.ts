import { getDatabase, getDriverType } from '@/db/connection';
import { SchemaSync } from '@/db/schema-sync';
import { hospitalConsultDoctorsTable } from '@/db/tables/hospital-consult-doctors';

interface ConsultDoctorsSchemaSingleton {
  promise: Promise<void> | null;
}

const _global = global as unknown as {
  __hospitalConsultDoctorsSchema?: ConsultDoctorsSchemaSingleton;
};
const _singleton: ConsultDoctorsSchemaSingleton = _global.__hospitalConsultDoctorsSchema ?? {
  promise: null,
};
if (!_global.__hospitalConsultDoctorsSchema) {
  _global.__hospitalConsultDoctorsSchema = _singleton;
}

export function ensureHospitalConsultDoctorsSchema(): Promise<void> {
  if (!_singleton.promise) {
    _singleton.promise = (async () => {
      const db = await getDatabase();
      await SchemaSync.sync(db, [hospitalConsultDoctorsTable], getDriverType());
    })().catch((error) => {
      _singleton.promise = null;
      throw error;
    });
  }
  return _singleton.promise;
}
