# Dockerfile - RutaLimpia
# Sirve el sitio estático (HTML/CSS/JS) con nginx, listo para Cloud Run.

FROM nginx:alpine

# Cloud Run inyecta la variable de entorno PORT (por defecto 8080).
# nginx no soporta variables de entorno en su config directamente,
# así que usamos envsubst para generar la config final al arrancar.
ENV PORT=8080

# Config base de nginx con placeholder ${PORT}
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Copia todo el contenido del sitio (index.html, css/, js/, assets, etc.)
# Ajusta esta ruta si tu código fuente vive en una subcarpeta (ej. ./public)
COPY . /usr/share/nginx/html

EXPOSE 8080

# La imagen oficial de nginx ya procesa automáticamente los templates
# en /etc/nginx/templates/*.template con envsubst al iniciar,
# sustituyendo ${PORT} por el valor real antes de lanzar nginx.
CMD ["nginx", "-g", "daemon off;"]
