import { NextResponse, type NextRequest } from 'next/server';
import { session } from '@/lib/backend';
import { validateVehicleAssignment } from '@/lib/vehicle-assignments';
import { writeVehicleAssignment } from '@/lib/vehicle-assignments-backend';

export async function POST(request: NextRequest) {
  if (request.headers.get('sec-fetch-site') === 'cross-site' ||
    request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    return NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400 });
  }
  const organization = request.nextUrl.searchParams.get('azienda');
  const { identity, db } = await session(organization);
  if (!db || !identity || identity.org.id !== organization)
    return NextResponse.json({ error: 'Azienda non accessibile.' }, { status: 403 });
  try {
    const action = validateVehicleAssignment(await request.json());
    const assignment = await writeVehicleAssignment(db, identity.org.id, action);
    return NextResponse.json({ assignment });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SyntaxError ? 'Richiesta non valida.' :
      error instanceof Error ? error.message : 'Salvataggio non riuscito.' }, { status: 400 });
  }
}
