"""Service-layer errors. Services raise these; app/main.py maps them to HTTP status codes.

Services never import FastAPI, so they can be used from scripts and tests directly.
"""


class ServiceError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str, details: object | None = None):
        super().__init__(message)
        self.message = message
        self.details = details


class NotFound(ServiceError):
    status_code = 404
    code = "not_found"


class AuthenticationFailed(ServiceError):
    status_code = 401
    code = "authentication_failed"


class PermissionDenied(ServiceError):
    status_code = 403
    code = "permission_denied"


class Conflict(ServiceError):
    status_code = 409
    code = "conflict"


class ValidationFailed(ServiceError):
    status_code = 422
    code = "validation_failed"
