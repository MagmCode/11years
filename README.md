# 11 años · creciendo a tu lado

Página interactiva que celebra **11 años de amistad**: dos tulipanes (uno amarillo, otro azul)
cuyos tallos se entrelazan como un abrazo mientras el tiempo recorre once años.

## Ver en vivo

**https://magmcode.github.io/11years/**

## Estructura

| Archivo | Contenido |
|---|---|
| `index.html` | Estructura semántica: HUD con contador, SVG del jardín, tarjeta final, tooltip y `<noscript>`. |
| `styles.css` | Fondo midnight con auroras, glassmorphism, tulipanes, contador, progreso y tooltip. |
| `scripts.js` | Línea de tiempo de la animación, tooltips, trenzado de tallos y lluvia de partículas. |

## Detalles técnicos

- **Línea de tiempo normalizada** (`0 → 1`) de 10,5 s sobre un único `requestAnimationFrame`;
  el contador, los tallos, las hojas, las flores, la tarjeta y la lluvia salen de ese mismo progreso.
- **Crecimiento de tallos** con `stroke-dashoffset` sobre los `<path>` de `<defs>`, replicados con `<use>`.
- **Trenzado real**: los cruces entre ambos tallos se detectan en runtime con `getPointAtLength`
  y se resuelven con un `clipPath` circular más `drop-shadow`, de modo que un tallo pasa por
  delante del otro en cada cruce.
- **Lluvia de brillitos** en un `<canvas>` con sprites radiales generados en runtime,
  en modo `lighter`, con parpadeo y estrellas de cuatro puntas.
- **Tooltips** accesibles por `hover`, por toque y por teclado (`Tab` + `Enter`/`Espacio`),
  con `role="tooltip"` y `aria-live` en el contador.
- **`prefers-reduced-motion`** respetado: la página salta directamente al estado final sin animación.

## Ejecutar en local

La página no hace ninguna petición `fetch`, así que funciona abriéndola con doble clic.
Para probarla con un servidor local:

```bash
python -m http.server 8000
```

Y abrir <http://localhost:8000>.

## Licencia

MIT
