unit HOSxPPCUAccount2PersonAncServiceDetailEntryFormUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, cxGraphics, cxLookAndFeels, cxLookAndFeelPainters, Menus,
  dxSkinsCore, dxSkinsDefaultPainters, StdCtrls, cxButtons, ExtCtrls,
  JvExControls, JvNavigationPane, cxControls, cxContainer, cxEdit, cxGroupBox,
  DB, DBClient, cxTextEdit, cxDBEdit, cxLabel, cxMaskEdit, cxDropDownEdit,
  cxLookupEdit, cxDBLookupEdit, cxDBLookupComboBox, cxCalendar, cxMemo;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}

type
  THOSxPPCUAccount2PersonAncServiceDetailEntryForm = class(TForm)
    JvNavPanelHeader1: TJvNavPanelHeader;
    Panel2: TPanel;
    CloseButton: TcxButton;
    SaveButton: TcxButton;
    DeleteButton: TcxButton;
    LogViewButton: TcxButton;
    cxGroupBox1: TcxGroupBox;
    PersonANCServiceDetailCDS: TClientDataSet;
    PersonANCServiceDetailDS: TDataSource;
    cxLabel1: TcxLabel;
    cxDBLookupComboBox1: TcxDBLookupComboBox;
    cxLabel2: TcxLabel;
    cxLabel3: TcxLabel;
    cxLabel4: TcxLabel;
    cxDBLookupComboBox2: TcxDBLookupComboBox;
    cxButton1: TcxButton;
    cxLabel5: TcxLabel;
    cxDBMemo1: TcxDBMemo;
    cxDBComboBox1: TcxDBComboBox;
    cxDBDateEdit1: TcxDBDateEdit;

    procedure PersonANCServiceDetailCDSBeforePost(DataSet: TDataSet);
    procedure CloseButtonClick(Sender: TObject);
    procedure SaveButtonClick(Sender: TObject);
    procedure DeleteButtonClick(Sender: TObject);
    procedure LogViewButtonClick(Sender: TObject);
    procedure FormCreate(Sender: TObject);
    procedure cxDBLookupComboBox1PropertiesEditValueChanged(Sender: TObject);
    procedure cxDBComboBox1PropertiesCloseUp(Sender: TObject);
    procedure cxDBLookupComboBox2PropertiesInitPopup(Sender: TObject);
    procedure cxButton1Click(Sender: TObject);
  private
    FPersonANCServiceDetailID: Integer;
    FPersonANCServiceID: Integer;
    FVN: String;
    procedure SetPersonANCServiceDetailID(const Value: Integer);
    procedure RefreshData;
    procedure DoSaveData;
    procedure DoDeleteData;
    procedure SetPersonANCServiceID(const Value: Integer);
    procedure SetVN(const Value: String);
    { Private declarations }
  public
    { Public declarations }
    property VN: String read FVN write SetVN;
    property PersonANCServiceID: Integer read FPersonANCServiceID write SetPersonANCServiceID;
    property PersonANCServiceDetailID: Integer read FPersonANCServiceDetailID write SetPersonANCServiceDetailID;
    class procedure DoShowForm(xVN: String; xPersonANCServiceID, xPersonANCServiceDetailID: Integer);
  end;

var
  HOSxPPCUAccount2PersonAncServiceDetailEntryForm: THOSxPPCUAccount2PersonAncServiceDetailEntryForm;

implementation

uses HOSxPDMU, siauto, BMSApplicationUtil, HOSxPPCUAccount2DataModuleUnit;

{$R *.dfm}
{ THOSxPSystemSettingIPDBedEntryForm }

procedure THOSxPPCUAccount2PersonAncServiceDetailEntryForm.PersonANCServiceDetailCDSBeforePost(DataSet: TDataSet);
begin
  if (DataSet.State in [dsinsert]) then
  begin
    DataSet.FieldByName('person_anc_service_detail_id').AsInteger := FPersonANCServiceDetailID;
  end;

  DataSet.FieldByName('person_anc_service_id').AsInteger := FPersonANCServiceID;

end;

procedure THOSxPPCUAccount2PersonAncServiceDetailEntryForm.SaveButtonClick(Sender: TObject);
begin
  DoSaveData;
  Close;
end;

procedure THOSxPPCUAccount2PersonAncServiceDetailEntryForm.cxButton1Click(Sender: TObject);
var
  s: string;
begin
  s := ShowFindDoctorCodeDialog;
  if s <> '' then
  begin
    if (PersonANCServiceDetailCDS.State in [dsbrowse]) then
    begin
      if PersonANCServiceDetailCDS.RecordCount = 0 then
        PersonANCServiceDetailCDS.Append
      else
        PersonANCServiceDetailCDS.Edit;
    end;

    PersonANCServiceDetailCDS.FieldByName('anc_doctor_code').AsString := s;

  end;
end;

procedure THOSxPPCUAccount2PersonAncServiceDetailEntryForm.cxDBComboBox1PropertiesCloseUp(Sender: TObject);
var
  vcc_id: Integer;
  vcc_code: string;
  LotNo: string;
begin
  simain.logmessage('Edit value : ' + vartostr(cxDBLookupComboBox1.EditValue));

  if vartostr(cxDBLookupComboBox1.EditValue) = '' then
    exit;

  try
    vcc_id := getsqldata('select p1.person_vaccine_id from person_vaccine p1,anc_service a1 where a1.anc_service_id = ' +
      inttostr(strtointdef(vartostr(cxDBLookupComboBox1.EditValue), 0)) + ' and a1.export_vaccine_code = p1.export_vaccine_code');
  except
    vcc_id := 0;
  end;

  if vcc_id > 0 then
  begin
    vcc_code := vartostr(getsqldata('select vaccine_group from person_vaccine where person_vaccine_id = ' + inttostr(vcc_id)));

    LotNo := vartostr(cxDBComboBox1.EditValue);
    if LotNo <> '' then
    begin

      if (PersonANCServiceDetailCDS.State in [dsbrowse]) then
      begin
        if PersonANCServiceDetailCDS.RecordCount = 0 then
          PersonANCServiceDetailCDS.Append
        else
          PersonANCServiceDetailCDS.Edit;
      end;

      PersonANCServiceDetailCDS.FieldByName('vaccine_expire_date').AsDateTime :=

        getsqldata('select  expire_date from person_vaccine_group_lot where vaccine_group = "' + vcc_code + '" and vaccine_lot="' + LotNo + '"');
    end;

  end;

end;

procedure THOSxPPCUAccount2PersonAncServiceDetailEntryForm.cxDBLookupComboBox1PropertiesEditValueChanged(Sender: TObject);
var
  vcc_id: Integer;
  vcc_code: string;
begin
  simain.logmessage('Edit value : ' + vartostr(cxDBLookupComboBox1.EditValue));

  if vartostr(cxDBLookupComboBox1.EditValue) = '' then
    exit;

  try
    vcc_id := getsqldata('select p1.person_vaccine_id from person_vaccine p1,anc_service a1 where a1.anc_service_id = ' +
      inttostr(strtointdef(vartostr(cxDBLookupComboBox1.EditValue), 0)) + ' and a1.export_vaccine_code = p1.export_vaccine_code');
  except
    vcc_id := 0;
  end;

  if vcc_id > 0 then
  begin
    vcc_code := vartostr(getsqldata('select vaccine_group from person_vaccine where person_vaccine_id = ' + inttostr(vcc_id)));

    getlistfromtableex5(cxDBComboBox1.Properties.Items, 'select  vaccine_lot from person_vaccine_group_lot where vaccine_group = "' + vcc_code +
      '" and vaccine_lot_active="Y"');

  end;

end;

procedure THOSxPPCUAccount2PersonAncServiceDetailEntryForm.cxDBLookupComboBox2PropertiesInitPopup(Sender: TObject);
begin
  cxDBLookupComboBox2.Properties.ListSource := HOSxPPCUAccount2DataModule.ActiveDoctorDS;
end;

procedure THOSxPPCUAccount2PersonAncServiceDetailEntryForm.DeleteButtonClick(Sender: TObject);
begin
  if messagedlg('Please confirm delete data ?', mtconfirmation, [mbyes, mbno], 0) <> mryes then
    exit;
  DoDeleteData;
  Close;
end;

procedure THOSxPPCUAccount2PersonAncServiceDetailEntryForm.CloseButtonClick(Sender: TObject);
begin
  Close;
end;

procedure THOSxPPCUAccount2PersonAncServiceDetailEntryForm.LogViewButtonClick(Sender: TObject);
begin
  SafeLoadPackage('HOSxPUserManagerPackage.bpl');

  ExecuteRTTIFunction('HOSxPUserManagerLogViewerFormUnit.THOSxPUserManagerLogViewerForm', 'DoShowForm',
    ['"person_anc_service_detail"', inttostr(FPersonANCServiceDetailID)]);
end;

procedure THOSxPPCUAccount2PersonAncServiceDetailEntryForm.DoDeleteData;
begin
  if (PersonANCServiceDetailCDS.State in [dsinsert, dsedit]) then
  begin
    PersonANCServiceDetailCDS.cancel;

  end;

  if PersonANCServiceDetailCDS.RecordCount > 0 then
    PersonANCServiceDetailCDS.delete;

  if PersonANCServiceDetailCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta_log(PersonANCServiceDetailCDS, 'select * from person_anc_service_detail where person_anc_service_detail_id = ' +
      inttostr(FPersonANCServiceDetailID), '', '', '');
    PersonANCServiceDetailCDS.MergeChangeLog;
  end;

  if getsqldata('select count(*) as cc from ovst_vaccine where ref_key_code = "person_anc_service_detail:' + inttostr(FPersonANCServiceDetailID) +
    '"') > 0 then
    RawExecuteSQL_RS('delete from ovst_vaccine where ref_key_code = "person_anc_service_detail:' + inttostr(FPersonANCServiceDetailID) + '"');

end;

procedure THOSxPPCUAccount2PersonAncServiceDetailEntryForm.DoSaveData;
var
  expVccCode: string;
  personVaccineID: Integer;
begin
  if (PersonANCServiceDetailCDS.State in [dsinsert, dsedit]) then
  begin
    PersonANCServiceDetailCDS.post;

  end;

  if PersonANCServiceDetailCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta_log(PersonANCServiceDetailCDS, 'select * from person_anc_service_detail where person_anc_service_detail_id = ' +
      inttostr(FPersonANCServiceDetailID), '', '', '');
    PersonANCServiceDetailCDS.MergeChangeLog;
  end;

  expVccCode := vartostr(getsqldata('select export_vaccine_code from anc_service where anc_service_id = ' +
    inttostr(PersonANCServiceDetailCDS.FieldByName('anc_service_id').AsInteger)));
  personVaccineID := 0;
  try
    if expVccCode <> '' then

      personVaccineID := getsqldata('select person_vaccine_id from person_vaccine where export_vaccine_code = "' + expVccCode + '"');
  except

  end;

  if length(expVccCode) = 3 then
   // if (strtointdef(copy(expVccCode, 1, 1), 0) in [1, 2]) or (copy(expVccCode, 1, 1)='P') then
    if copy(expVccCode, 1, 1)<>'0' then
      if personVaccineID > 0 then

      begin
        DoSyncPCUVaccineToOvstVaccine('person_anc_service_detail:' + inttostr(FPersonANCServiceDetailID), FVN, personVaccineID,
          PersonANCServiceDetailCDS.FieldByName('anc_doctor_code').AsString, PersonANCServiceDetailCDS.FieldByName('vaccine_lotno').AsString,
          PersonANCServiceDetailCDS.FieldByName('vaccine_expire_date').AsDateTime);

      end;

end;

class procedure THOSxPPCUAccount2PersonAncServiceDetailEntryForm.DoShowForm(xVN: String; xPersonANCServiceID, xPersonANCServiceDetailID: Integer);
var
  FHOSxPPCUAccount2PersonAncServiceDetailEntryForm: THOSxPPCUAccount2PersonAncServiceDetailEntryForm;
begin
  FHOSxPPCUAccount2PersonAncServiceDetailEntryForm := THOSxPPCUAccount2PersonAncServiceDetailEntryForm.Create(application);
  try
    FHOSxPPCUAccount2PersonAncServiceDetailEntryForm.VN := xVN;
    FHOSxPPCUAccount2PersonAncServiceDetailEntryForm.PersonANCServiceID := xPersonANCServiceID;
    FHOSxPPCUAccount2PersonAncServiceDetailEntryForm.PersonANCServiceDetailID := xPersonANCServiceDetailID;
    FHOSxPPCUAccount2PersonAncServiceDetailEntryForm.ShowModal;
  finally
    FHOSxPPCUAccount2PersonAncServiceDetailEntryForm.Free;
  end;

end;

procedure THOSxPPCUAccount2PersonAncServiceDetailEntryForm.FormCreate(Sender: TObject);
begin
  if not assigned(HOSxPPCUAccount2DataModule) then
    HOSxPPCUAccount2DataModule := THOSxPPCUAccount2DataModule.Create(application);
end;

procedure THOSxPPCUAccount2PersonAncServiceDetailEntryForm.RefreshData;
begin

  PersonANCServiceDetailCDS.Data := hosxp_getdataset('select * from person_anc_service_detail where person_anc_service_detail_id = ' +
    inttostr(FPersonANCServiceDetailID));
end;

procedure THOSxPPCUAccount2PersonAncServiceDetailEntryForm.SetPersonANCServiceDetailID(const Value: Integer);
begin
  FPersonANCServiceDetailID := Value;
  if FPersonANCServiceDetailID = 0 then
  begin
    repeat
      FPersonANCServiceDetailID := getserialnumber('person_anc_service_detail_id');
      // GetNewCodeFromTable('person_anc_service_detail', 'person_anc_service_detail_id', '', '001', 3);
    until getsqldata('select count(*) as cc from person_anc_service_detail where person_anc_service_detail_id = ' +
      inttostr(FPersonANCServiceDetailID)) = 0;
  end;
  RefreshData;
end;

procedure THOSxPPCUAccount2PersonAncServiceDetailEntryForm.SetPersonANCServiceID(const Value: Integer);
begin
  FPersonANCServiceID := Value;
end;

procedure THOSxPPCUAccount2PersonAncServiceDetailEntryForm.SetVN(const Value: String);
begin
  FVN := Value;
end;

end.
