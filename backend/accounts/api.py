from django.contrib.auth import authenticate
from django.db.models import Q
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.exceptions import TokenError
from .models import User

class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField(required=True, error_messages={"required":"Email is required.","invalid":"Email is not valid."})
    password = serializers.CharField(required=True, write_only=True, error_messages={"required":"Password is required."})

class LoginView(APIView):
    permission_classes = [AllowAny]
    # The scope alone does nothing: ScopedRateThrottle must be enabled for the rate to apply.
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"
    def post(self, request):
        data = LoginSerializer(data=request.data)
        if not data.is_valid(): return Response({"code":"validation_error","detail":"Please correct the highlighted fields.","fields":data.errors}, status=400)
        email, password = data.validated_data["email"].lower().strip(), data.validated_data["password"]
        user_record = User.objects.filter(Q(username__iexact=email) | Q(email__iexact=email)).first()
        if user_record is None:
            return Response({"code":"invalid_email","detail":"Email is not valid.","fields":{"email":["Email is not valid."]}}, status=401)
        user = authenticate(request, username=user_record.username, password=password)
        if not user:
            return Response({"code":"invalid_credentials","detail":"Wrong password.","fields":{"password":["Wrong password."]}}, status=401)
        if not user.is_active: return Response({"code":"account_disabled","detail":"This account is disabled.","fields":{"email":["Account is disabled."]}}, status=403)
        refresh = RefreshToken.for_user(user)
        return Response({"access":str(refresh.access_token),"refresh":str(refresh),"user":{"id":user.id,"email":user.email,"name":user.get_full_name() or user.username,"role":user.role}})

class MeView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        u=request.user; return Response({"id":u.id,"email":u.email,"name":u.get_full_name() or u.username,"role":u.role,"alertPreferences":u.alert_preferences})
    def patch(self, request):
        u=request.user
        if "alertPreferences" in request.data:
            if not isinstance(request.data["alertPreferences"], dict): return Response({"code":"validation_error","fields":{"alertPreferences":["Alert preferences must be an object."]}}, status=400)
            u.alert_preferences=request.data["alertPreferences"]; u.save(update_fields=["alert_preferences"])
        return self.get(request)

class LogoutView(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        token=request.data.get("refresh")
        if not token: return Response({"code":"validation_error","fields":{"refresh":["Refresh token is required."]}}, status=400)
        try: RefreshToken(token).blacklist()
        except TokenError: return Response({"code":"invalid_token","detail":"Refresh token is invalid or expired."}, status=400)
        return Response(status=status.HTTP_204_NO_CONTENT)
