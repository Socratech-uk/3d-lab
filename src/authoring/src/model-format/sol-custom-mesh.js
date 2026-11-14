const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const point3 = value => [
  finite(value?.[0]),
  finite(value?.[1]),
  finite(value?.[2]),
];

export function normaliseSolMeshGeometry(input = {}) {
  const vertices = Array.isArray(input.vertices) ? input.vertices.slice(0, 65535).map(point3) : [];
  const faces = [];
  for (const source of Array.isArray(input.faces) ? input.faces : []) {
    const indices = (Array.isArray(source) ? source : source?.vertices)
      ?.map(value => Math.trunc(finite(value, -1)))
      .filter((value, index, values) => value >= 0 && value < vertices.length && values.indexOf(value) === index) || [];
    if (indices.length < 3) continue;
    faces.push({
      vertices: indices,
      materialId: !Array.isArray(source) && source?.materialId ? String(source.materialId) : null,
      surfaceId: !Array.isArray(source) && source?.surfaceId ? String(source.surfaceId) : null,
      name: !Array.isArray(source) && source?.name ? String(source.name) : '',
    });
  }
  // Optional vertex-aligned streams make captures of existing render meshes
  // editable without losing their authored UV seams or smooth normals. An
  // incomplete/non-finite stream is discarded as a whole, so topology edits
  // cannot accidentally associate an old attribute with a different vertex.
  const stream = (source, width) => Array.isArray(source) && source.length === vertices.length
    && source.every(value => Array.isArray(value) && value.length === width && value.every(Number.isFinite))
    ? source.map(value => [...value]) : null;
  const uvs = stream(input.uvs, 2), normals = stream(input.normals, 3);
  const shipOrigin = Array.isArray(input.shipOrigin) && input.shipOrigin.length === 3 && input.shipOrigin.every(Number.isFinite)
    ? [...input.shipOrigin] : null;
  return { vertices, faces, ...(uvs ? { uvs } : {}), ...(normals ? { normals } : {}), ...(shipOrigin ? { shipOrigin } : {}) };
}

function faceNormal(mesh, faceIndex) {
  const face = mesh.faces[faceIndex];
  if (!face) return [0, 1, 0];
  const origin = mesh.vertices[face.vertices[0]];
  for (let index = 1; index < face.vertices.length - 1; index += 1) {
    const a = mesh.vertices[face.vertices[index]];
    const b = mesh.vertices[face.vertices[index + 1]];
    const ab = [a[0] - origin[0], a[1] - origin[1], a[2] - origin[2]];
    const ac = [b[0] - origin[0], b[1] - origin[1], b[2] - origin[2]];
    const normal = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const length = Math.hypot(...normal);
    if (length > 1e-7) return normal.map(value => value / length);
  }
  return [0, 1, 0];
}

export function solMeshFaceNormal(geometry, faceIndex) {
  return faceNormal(normaliseSolMeshGeometry(geometry), faceIndex);
}

/** Flat-shaded triangle batches grouped by face material. */
export function triangulateSolMesh(geometry, fallbackMaterialId = null) {
  const mesh = normaliseSolMeshGeometry(geometry);
  const batches = new Map();
  mesh.faces.forEach((face, faceIndex) => {
    const materialId = face.materialId || fallbackMaterialId || '';
    if (!batches.has(materialId)) batches.set(materialId, {
      materialId, positions: [], normals: [], indices: [], faceIndices: [], ...(mesh.uvs ? { uvs: [] } : {}),
      ...(mesh.shipOrigin ? { shipOrigin: [...mesh.shipOrigin] } : {}),
    });
    const batch = batches.get(materialId);
    const normal = faceNormal(mesh, faceIndex);
    for (let corner = 1; corner < face.vertices.length - 1; corner += 1) {
      const triangle = [face.vertices[0], face.vertices[corner], face.vertices[corner + 1]];
      const offset = batch.positions.length / 3;
      for (const vertexIndex of triangle) {
        batch.positions.push(...mesh.vertices[vertexIndex]);
        batch.normals.push(...(mesh.normals?.[vertexIndex] || normal));
        if (mesh.uvs) batch.uvs.push(...mesh.uvs[vertexIndex]);
      }
      batch.indices.push(offset, offset + 1, offset + 2);
      batch.faceIndices.push(faceIndex);
    }
  });
  return [...batches.values()];
}

export function createSolPolygonGeometry(points, { plane = 'xz', thickness = 0 } = {}) {
  const source = (Array.isArray(points) ? points : []).map(point => [finite(point?.[0]), finite(point?.[1])]);
  if (source.length < 3) return { vertices: [], faces: [] };
  const half = Math.max(0, finite(thickness)) * .5;
  const vertex = (point, depth) => plane === 'xy'
    ? [point[0], point[1], depth]
    : plane === 'yz' ? [depth, point[1], point[0]] : [point[0], depth, point[1]];
  if (half <= 1e-6) return {
    vertices: source.map(point => vertex(point, 0)),
    faces: [{ vertices: source.map((_, index) => index), name: 'Fill' }],
  };
  const vertices = [
    ...source.map(point => vertex(point, -half)),
    ...source.map(point => vertex(point, half)),
  ];
  const count = source.length;
  const faces = [
    { vertices: source.map((_, index) => count - 1 - index), name: 'Back' },
    { vertices: source.map((_, index) => count + index), name: 'Front' },
  ];
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    faces.push({ vertices: [index, next, count + next, count + index], name: `Edge ${index + 1}` });
  }
  return { vertices, faces };
}

export function createSolGridGeometry(columns = 2, rows = 2, width = 1, depth = 1) {
  const cols = Math.max(1, Math.min(32, Math.trunc(finite(columns, 2))));
  const rowCount = Math.max(1, Math.min(32, Math.trunc(finite(rows, 2))));
  const vertices = [];
  const faces = [];
  for (let row = 0; row <= rowCount; row += 1) {
    for (let column = 0; column <= cols; column += 1) {
      vertices.push([(column / cols - .5) * finite(width, 1), 0, (row / rowCount - .5) * finite(depth, 1)]);
    }
  }
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      const a = row * (cols + 1) + column;
      faces.push({ vertices: [a, a + cols + 1, a + cols + 2, a + 1], name: `Cell ${row + 1}.${column + 1}` });
    }
  }
  return { vertices, faces };
}

export const solMeshEdgeKey = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;

/** Derived, non-duplicated topology edges with their incident faces. */
export function solMeshEdges(geometry) {
  const mesh = normaliseSolMeshGeometry(geometry);
  const edges = new Map();
  mesh.faces.forEach((face, faceIndex) => face.vertices.forEach((a, index) => {
    const b = face.vertices[(index + 1) % face.vertices.length];
    const key = solMeshEdgeKey(a, b);
    if (!edges.has(key)) edges.set(key, { key, a: Math.min(a, b), b: Math.max(a, b), faces: [] });
    edges.get(key).faces.push(faceIndex);
  }));
  return [...edges.values()];
}

export function solMeshVertexNeighbours(geometry) {
  const mesh = normaliseSolMeshGeometry(geometry);
  const neighbours = mesh.vertices.map(() => new Set());
  for (const edge of solMeshEdges(mesh)) { neighbours[edge.a].add(edge.b); neighbours[edge.b].add(edge.a); }
  return neighbours.map(entries => [...entries]);
}

export function bridgeSolMeshEdges(geometry, firstKey, secondKey, attributes = {}) {
  const mesh = normaliseSolMeshGeometry(geometry), edges = solMeshEdges(mesh);
  const first = edges.find(edge => edge.key === firstKey), second = edges.find(edge => edge.key === secondKey);
  if (!first || !second || first.key === second.key) return { geometry: mesh, faceIndex: -1 };
  const direct = Math.hypot(...mesh.vertices[first.a].map((value, axis) => value - mesh.vertices[second.a][axis])) + Math.hypot(...mesh.vertices[first.b].map((value, axis) => value - mesh.vertices[second.b][axis]));
  const crossed = Math.hypot(...mesh.vertices[first.a].map((value, axis) => value - mesh.vertices[second.b][axis])) + Math.hypot(...mesh.vertices[first.b].map((value, axis) => value - mesh.vertices[second.a][axis]));
  const [c, d] = crossed < direct ? [second.a, second.b] : [second.b, second.a];
  const faceIndex = mesh.faces.push({ vertices: [first.a, first.b, c, d], materialId: attributes.materialId || null, surfaceId: attributes.surfaceId || null, name: attributes.name || 'Bridged edges' }) - 1;
  return { geometry: mesh, faceIndex };
}

export function stampSolMeshFace(geometry, faceIndex, point, { radius = .1, sides = 8 } = {}) {
  const mesh = normaliseSolMeshGeometry(geometry), face = mesh.faces[faceIndex];
  if (!face || face.vertices.length < 3) return { geometry: mesh, faceIndex: -1, vertexIndices: [] };
  const centre = point3(point), normal = solMeshFaceNormal(mesh, faceIndex), n = new Float64Array(normal);
  let tangent = mesh.vertices[face.vertices[0]].map((value, axis) => value - centre[axis]);
  const tangentDot = tangent.reduce((sum, value, axis) => sum + value * n[axis], 0);
  tangent = tangent.map((value, axis) => value - n[axis] * tangentDot);
  let tangentLength = Math.hypot(...tangent);
  if (tangentLength < 1e-7) tangent = Math.abs(n[1]) < .9 ? [n[2], 0, -n[0]] : [1, 0, 0], tangentLength = Math.hypot(...tangent);
  tangent = tangent.map(value => value / tangentLength);
  let bitangent = [n[1] * tangent[2] - n[2] * tangent[1], n[2] * tangent[0] - n[0] * tangent[2], n[0] * tangent[1] - n[1] * tangent[0]];
  const outer2d = face.vertices.map(index => { const delta = mesh.vertices[index].map((value, axis) => value - centre[axis]); return [delta.reduce((sum, value, axis) => sum + value * tangent[axis], 0), delta.reduce((sum, value, axis) => sum + value * bitangent[axis], 0)]; });
  let insideRadius = Infinity;
  for (let index = 0; index < outer2d.length; index += 1) {
    const a = outer2d[index], b = outer2d[(index + 1) % outer2d.length], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1;
    insideRadius = Math.min(insideRadius, Math.abs(a[0] * b[1] - a[1] * b[0]) / length);
  }
  const ringRadius = Math.max(1e-4, Math.min(Math.abs(finite(radius, .1)), Number.isFinite(insideRadius) ? insideRadius * .72 : Math.abs(finite(radius, .1))));
  const count = Math.max(3, Math.min(32, Math.trunc(finite(sides, 8)))), ring = [];
  for (let index = 0; index < count; index += 1) {
    const angle = index / count * Math.PI * 2;
    ring.push(mesh.vertices.push(centre.map((value, axis) => value + tangent[axis] * Math.cos(angle) * ringRadius + bitangent[axis] * Math.sin(angle) * ringRadius)) - 1);
  }
  const original = { ...face, vertices: [...face.vertices] }, replacements = [{ ...original, vertices: ring, name: `${original.name || 'Face'} brush patch` }];
  let outerIndex = 0, ringIndex = 0;
  while (outerIndex < original.vertices.length || ringIndex < ring.length) {
    const outerNext = (outerIndex + 1) / original.vertices.length, ringNext = (ringIndex + 1) / ring.length;
    if (outerIndex < original.vertices.length && (ringIndex >= ring.length || outerNext <= ringNext)) {
      replacements.push({ ...original, vertices: [original.vertices[outerIndex % original.vertices.length], original.vertices[(outerIndex + 1) % original.vertices.length], ring[ringIndex % ring.length]], name: `${original.name || 'Face'} outer ${replacements.length}` });
      outerIndex += 1;
    } else {
      replacements.push({ ...original, vertices: [original.vertices[outerIndex % original.vertices.length], ring[(ringIndex + 1) % ring.length], ring[ringIndex % ring.length]], name: `${original.name || 'Face'} inner ${replacements.length}` });
      ringIndex += 1;
    }
  }
  mesh.faces.splice(faceIndex, 1, ...replacements);
  return { geometry: mesh, faceIndex, vertexIndices: ring, radius: ringRadius };
}

/** Convert a SOL primitive's local geometry into editable polygon topology. */
export function createSolPrimitiveMeshGeometry(type, size = [1, 1, 1], { radialSegments = 16, heightSegments = 8 } = {}) {
  const [sx, sy, sz] = point3(size).map(value => Math.max(.001, Math.abs(value)));
  if (type === 'box' || type === 'plate' || type === 'taper') {
    const vertices = [
      [-sx, -sy, -sz], [sx, -sy, -sz], [sx, sy, -sz], [-sx, sy, -sz],
      [-sx, -sy, sz], [sx, -sy, sz], [sx, sy, sz], [-sx, sy, sz],
    ];
    return { vertices, faces: [
      { vertices: [0, 3, 2, 1], name: 'Front' }, { vertices: [4, 5, 6, 7], name: 'Back' },
      { vertices: [0, 4, 7, 3], name: 'Left' }, { vertices: [1, 2, 6, 5], name: 'Right' },
      { vertices: [3, 7, 6, 2], name: 'Top' }, { vertices: [0, 1, 5, 4], name: 'Bottom' },
    ] };
  }
  const radial = Math.max(6, Math.min(48, Math.trunc(finite(radialSegments, 16))));
  if (type === 'cylinder') {
    const vertices = [];
    for (const y of [-sy, sy]) for (let index = 0; index < radial; index += 1) {
      const angle = index / radial * Math.PI * 2;
      vertices.push([Math.cos(angle) * sx, y, Math.sin(angle) * sz]);
    }
    const faces = [
      { vertices: Array.from({ length: radial }, (_, index) => radial - 1 - index), name: 'Bottom' },
      { vertices: Array.from({ length: radial }, (_, index) => radial + index), name: 'Top' },
    ];
    for (let index = 0; index < radial; index += 1) {
      const next = (index + 1) % radial;
      faces.push({ vertices: [index, next, radial + next, radial + index], name: `Side ${index + 1}` });
    }
    faces.forEach(face => face.vertices.reverse());
    return { vertices, faces };
  }
  const rings = Math.max(4, Math.min(24, Math.trunc(finite(heightSegments, 8))));
  const capsule = type === 'capsule';
  const vertices = [[0, capsule ? sy * 1.4 : sy, 0]];
  for (let ring = 1; ring < rings; ring += 1) {
    const phi = Math.PI * ring / rings;
    const sin = Math.sin(phi);
    const y = Math.cos(phi) * sy + (capsule ? Math.sign(Math.cos(phi)) * sy * .4 : 0);
    for (let index = 0; index < radial; index += 1) {
      const angle = index / radial * Math.PI * 2;
      vertices.push([Math.cos(angle) * sx * sin, y, Math.sin(angle) * sz * sin]);
    }
  }
  const bottom = vertices.push([0, capsule ? -sy * 1.4 : -sy, 0]) - 1;
  const faces = [];
  for (let index = 0; index < radial; index += 1) faces.push({ vertices: [0, 1 + index, 1 + (index + 1) % radial], name: `Top ${index + 1}` });
  for (let ring = 0; ring < rings - 2; ring += 1) for (let index = 0; index < radial; index += 1) {
    const next = (index + 1) % radial;
    const a = 1 + ring * radial + index, b = 1 + ring * radial + next;
    faces.push({ vertices: [a, 1 + (ring + 1) * radial + index, 1 + (ring + 1) * radial + next, b], name: `Surface ${ring + 1}.${index + 1}` });
  }
  const lastRing = 1 + (rings - 2) * radial;
  for (let index = 0; index < radial; index += 1) faces.push({ vertices: [lastRing + index, bottom, lastRing + (index + 1) % radial], name: `Bottom ${index + 1}` });
  faces.forEach(face => face.vertices.reverse());
  return { vertices, faces };
}

/** Extrude one face, replacing it with a translated cap and connected sides. */
export function extrudeSolMeshFace(geometry, faceIndex, distance = .1) {
  const mesh = normaliseSolMeshGeometry(geometry);
  const face = mesh.faces[faceIndex];
  if (!face) return { geometry: mesh, faceIndex: -1, vertexIndices: [] };
  const normal = solMeshFaceNormal(mesh, faceIndex);
  const top = face.vertices.map(index => mesh.vertices.push(mesh.vertices[index].map((value, axis) => value + normal[axis] * finite(distance, .1))) - 1);
  const cap = { ...face, name: `${face.name || `Face ${faceIndex + 1}`} extrusion`, vertices: top };
  mesh.faces[faceIndex] = cap;
  face.vertices.forEach((index, corner) => {
    const nextCorner = (corner + 1) % face.vertices.length;
    mesh.faces.push({
      vertices: [index, face.vertices[nextCorner], top[nextCorner], top[corner]],
      materialId: face.materialId,
      surfaceId: face.surfaceId,
      name: `${face.name || `Face ${faceIndex + 1}`} wall ${corner + 1}`,
    });
  });
  return { geometry: mesh, faceIndex, vertexIndices: top };
}

export function splitSolMeshEdge(geometry, edgeKey) {
  const mesh = normaliseSolMeshGeometry(geometry);
  const edge = solMeshEdges(mesh).find(candidate => candidate.key === edgeKey);
  if (!edge) return { geometry: mesh, vertexIndex: -1 };
  const a = mesh.vertices[edge.a], b = mesh.vertices[edge.b];
  const vertexIndex = mesh.vertices.push(a.map((value, axis) => (value + b[axis]) * .5)) - 1;
  for (const faceIndex of edge.faces) {
    const vertices = mesh.faces[faceIndex].vertices;
    for (let index = 0; index < vertices.length; index += 1) {
      const next = (index + 1) % vertices.length;
      if ((vertices[index] === edge.a && vertices[next] === edge.b) || (vertices[index] === edge.b && vertices[next] === edge.a)) {
        vertices.splice(index + 1, 0, vertexIndex);
        break;
      }
    }
  }
  return { geometry: mesh, vertexIndex };
}

/** Split a polygon by connecting two non-adjacent vertices already on it. */
export function connectSolMeshVertices(geometry, first, second) {
  const mesh = normaliseSolMeshGeometry(geometry);
  if (first === second) return { geometry: mesh, faceIndices: [] };
  const faceIndex = mesh.faces.findIndex(face => face.vertices.includes(first) && face.vertices.includes(second));
  const face = mesh.faces[faceIndex];
  if (!face) return { geometry: mesh, faceIndices: [] };
  const a = face.vertices.indexOf(first), b = face.vertices.indexOf(second);
  const distance = Math.abs(a - b);
  if (distance === 1 || distance === face.vertices.length - 1) return { geometry: mesh, faceIndices: [] };
  const walk = (from, to) => {
    const result = [face.vertices[from]];
    for (let cursor = from; cursor !== to;) { cursor = (cursor + 1) % face.vertices.length; result.push(face.vertices[cursor]); }
    return result;
  };
  const firstFace = { ...face, name: `${face.name || `Face ${faceIndex + 1}`} A`, vertices: walk(a, b) };
  const secondFace = { ...face, name: `${face.name || `Face ${faceIndex + 1}`} B`, vertices: walk(b, a) };
  mesh.faces.splice(faceIndex, 1, firstFace, secondFace);
  return { geometry: mesh, faceIndices: [faceIndex, faceIndex + 1] };
}

const lerpPoint3 = (from, to, amount) => from.map((value, axis) => value + (to[axis] - value) * amount);

export function solMeshQuadPoint(geometry, faceIndex, u = .5, v = .5) {
  const mesh = normaliseSolMeshGeometry(geometry);
  const face = mesh.faces[faceIndex];
  if (!face || face.vertices.length !== 4) return null;
  const amountU = Math.max(0, Math.min(1, finite(u, .5)));
  const amountV = Math.max(0, Math.min(1, finite(v, .5)));
  const [a, b, c, d] = face.vertices.map(index => mesh.vertices[index]);
  return lerpPoint3(lerpPoint3(a, b, amountU), lerpPoint3(d, c, amountU), amountV);
}

function insertVerticesAlongSharedEdge(mesh, excludedFaceIndex, first, second, orderedIndices) {
  if (!orderedIndices.length) return;
  mesh.faces.forEach((face, faceIndex) => {
    if (faceIndex === excludedFaceIndex) return;
    for (let corner = 0; corner < face.vertices.length; corner += 1) {
      const next = (corner + 1) % face.vertices.length;
      const a = face.vertices[corner], b = face.vertices[next];
      if (a === first && b === second) {
        face.vertices.splice(corner + 1, 0, ...orderedIndices);
        return;
      }
      if (a === second && b === first) {
        face.vertices.splice(corner + 1, 0, ...[...orderedIndices].reverse());
        return;
      }
    }
  });
}

/**
 * Replace one quad with a stitched lattice. Boundary vertices are inserted in
 * neighbouring polygons too, so the result remains one connected surface.
 */
export function latticeSolMeshQuad(geometry, faceIndex, { columns = 2, rows = 2, pattern = 'quads' } = {}) {
  const mesh = normaliseSolMeshGeometry(geometry);
  const face = mesh.faces[faceIndex];
  if (!face || face.vertices.length !== 4) return { geometry: mesh, faceIndices: [], vertexIndices: [], grid: [] };
  const columnCount = Math.max(1, Math.min(32, Math.trunc(finite(columns, 2))));
  const rowCount = Math.max(1, Math.min(32, Math.trunc(finite(rows, 2))));
  const cellPattern = ['quads', 'triangles', 'diamond'].includes(pattern) ? pattern : 'quads';
  const [cornerA, cornerB, cornerC, cornerD] = face.vertices;
  const [pointA, pointB, pointC, pointD] = face.vertices.map(index => mesh.vertices[index]);
  const grid = [];
  const created = [];
  for (let row = 0; row <= rowCount; row += 1) {
    const line = [];
    for (let column = 0; column <= columnCount; column += 1) {
      let vertexIndex;
      if (row === 0 && column === 0) vertexIndex = cornerA;
      else if (row === 0 && column === columnCount) vertexIndex = cornerB;
      else if (row === rowCount && column === columnCount) vertexIndex = cornerC;
      else if (row === rowCount && column === 0) vertexIndex = cornerD;
      else {
        const u = column / columnCount, v = row / rowCount;
        const point = lerpPoint3(lerpPoint3(pointA, pointB, u), lerpPoint3(pointD, pointC, u), v);
        vertexIndex = mesh.vertices.push(point) - 1;
        created.push(vertexIndex);
      }
      line.push(vertexIndex);
    }
    grid.push(line);
  }

  insertVerticesAlongSharedEdge(mesh, faceIndex, cornerA, cornerB, grid[0].slice(1, -1));
  insertVerticesAlongSharedEdge(mesh, faceIndex, cornerB, cornerC, grid.slice(1, -1).map(line => line[columnCount]));
  insertVerticesAlongSharedEdge(mesh, faceIndex, cornerC, cornerD, grid[rowCount].slice(1, -1).reverse());
  insertVerticesAlongSharedEdge(mesh, faceIndex, cornerD, cornerA, grid.slice(1, -1).map(line => line[0]).reverse());

  const replacements = [];
  const addFace = (vertices, suffix) => replacements.push({
    ...face,
    name: `${face.name || `Face ${faceIndex + 1}`} ${suffix}`,
    vertices,
  });
  for (let row = 0; row < rowCount; row += 1) for (let column = 0; column < columnCount; column += 1) {
    const topLeft = grid[row][column], topRight = grid[row][column + 1];
    const bottomRight = grid[row + 1][column + 1], bottomLeft = grid[row + 1][column];
    const label = `${row + 1}.${column + 1}`;
    if (cellPattern === 'triangles') {
      if ((row + column) % 2 === 0) {
        addFace([topLeft, topRight, bottomRight], `${label} A`);
        addFace([topLeft, bottomRight, bottomLeft], `${label} B`);
      } else {
        addFace([topLeft, topRight, bottomLeft], `${label} A`);
        addFace([topRight, bottomRight, bottomLeft], `${label} B`);
      }
    } else if (cellPattern === 'diamond') {
      const points = [topLeft, topRight, bottomRight, bottomLeft].map(index => mesh.vertices[index]);
      const centre = points[0].map((_, axis) => points.reduce((sum, point) => sum + point[axis], 0) / 4);
      const centreIndex = mesh.vertices.push(centre) - 1;
      created.push(centreIndex);
      addFace([topLeft, topRight, centreIndex], `${label} top`);
      addFace([topRight, bottomRight, centreIndex], `${label} right`);
      addFace([bottomRight, bottomLeft, centreIndex], `${label} bottom`);
      addFace([bottomLeft, topLeft, centreIndex], `${label} left`);
    } else addFace([topLeft, topRight, bottomRight, bottomLeft], label);
  }
  mesh.faces.splice(faceIndex, 1, ...replacements);
  return {
    geometry: mesh,
    faceIndices: replacements.map((_, index) => faceIndex + index),
    vertexIndices: created,
    grid,
  };
}

/** Insert one real vertex into any polygon and fan the face around it. */
export function insertSolMeshFacePoint(geometry, faceIndex, point, distance = 0) {
  const mesh = normaliseSolMeshGeometry(geometry);
  const face = mesh.faces[faceIndex];
  if (!face) return { geometry: mesh, faceIndices: [], vertexIndex: -1 };
  const normal = solMeshFaceNormal(mesh, faceIndex);
  const source = point3(point);
  const vertex = source.map((value, axis) => value + normal[axis] * finite(distance));
  const vertexIndex = mesh.vertices.push(vertex) - 1;
  const replacements = face.vertices.map((index, corner) => ({
    ...face,
    name: `${face.name || `Face ${faceIndex + 1}`} point ${corner + 1}`,
    vertices: [index, face.vertices[(corner + 1) % face.vertices.length], vertexIndex],
  }));
  mesh.faces.splice(faceIndex, 1, ...replacements);
  return {
    geometry: mesh,
    faceIndices: replacements.map((_, index) => faceIndex + index),
    vertexIndex,
  };
}

export function insertSolMeshQuadPoint(geometry, faceIndex, u = .5, v = .5, distance = 0) {
  const point = solMeshQuadPoint(geometry, faceIndex, u, v);
  return point ? insertSolMeshFacePoint(geometry, faceIndex, point, distance) : {
    geometry: normaliseSolMeshGeometry(geometry), faceIndices: [], vertexIndex: -1,
  };
}
